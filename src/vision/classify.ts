/**
 * Turns the 216 sampled sticker colours of a cube into colour ids.
 *
 * Model: in log-RGB space a change of light (brightness, colour temperature, exposure, white balance)
 * is close to an additive shift per channel. So each sample is modelled as
 *
 *   brightness(sticker) = centre(colour) + offset(face) + slope(face) . position + noise
 *   chroma(sticker)     = saturation(face) * centre(colour) + offset(face) + noise
 *
 * The saturation factor covers what a shift cannot: a face in shadow, or one seen at a glancing angle,
 * picks up ambient light and haze that pull every colour toward grey (measured on the reference
 * photos: side faces show 0.5 to 0.8 of the top face's log-chroma). The centres, the per-face terms
 * and the labels are fitted together, with the hard constraint
 * that each of the six colours is used exactly 36 times (see assign.ts). Nothing is thresholded: the
 * colour priors below only seed the search and name the result, and a seed taken from the data alone
 * competes with them, so unusual colour schemes work too.
 */
import { balancedAssign } from './assign';
import { labToRgb, rgbToCss, rgbToLab } from './color';
import type { Classification, ColourName, FaceSample } from './types';

const K = 6;
const PER_FACE = 36;
const N = K * PER_FACE;
const LOG_EPS = 6;
/** Weight of the brightness axis against the two chroma axes. Shading changes brightness a lot and chroma little. */
const W_BRIGHT = 0.12;
/** Ridge strengths (in pseudo-samples) that pull the per-face corrections toward "no correction". */
const RIDGE_CHROMA = 3;
const RIDGE_BRIGHT = 0.5;
const RIDGE_SLOPE = 2;
const RIDGE_SATURATION = 3;

export interface ColourPrior {
  name: ColourName;
  /** Typical camera colour, sRGB 0..255. */
  rgb: [number, number, number];
  /** Colour used on screen. */
  display: [number, number, number];
}

/**
 * Seed colours. The first set is measured from the reference photos of Ahmad's stickerless cube under
 * indoor light (top-face medians); the second is a classic stickered cube. Seeds only start the search.
 */
export const COLOUR_PRIORS: readonly (readonly ColourPrior[])[] = [
  [
    { name: 'white', rgb: [214, 214, 216], display: [243, 243, 239] },
    { name: 'yellow', rgb: [235, 215, 55], display: [255, 212, 31] },
    { name: 'red', rgb: [205, 50, 55], display: [217, 43, 43] },
    { name: 'orange', rgb: [255, 135, 30], display: [255, 138, 28] },
    { name: 'blue', rgb: [35, 110, 200], display: [31, 111, 224] },
    { name: 'green', rgb: [60, 205, 80], display: [45, 189, 78] },
  ],
  [
    { name: 'white', rgb: [225, 225, 225], display: [243, 243, 239] },
    { name: 'yellow', rgb: [215, 205, 40], display: [255, 212, 31] },
    { name: 'red', rgb: [170, 25, 30], display: [217, 43, 43] },
    { name: 'orange', rgb: [235, 100, 20], display: [255, 138, 28] },
    { name: 'blue', rgb: [15, 60, 160], display: [31, 111, 224] },
    { name: 'green', rgb: [20, 140, 60], display: [45, 189, 78] },
  ],
];

/** Log-opponent feature: [brightness, red-green, yellow-blue]. */
export function colourFeature(r: number, g: number, b: number, out: Float64Array | number[], o: number): void {
  const lr = Math.log(Math.max(0, r) + LOG_EPS);
  const lg = Math.log(Math.max(0, g) + LOG_EPS);
  const lb = Math.log(Math.max(0, b) + LOG_EPS);
  out[o] = (lr + lg + lb) / 3;
  out[o + 1] = lr - lg;
  out[o + 2] = (lr + lg) / 2 - lb;
}

function featureToRgb(l: number, c1: number, c2: number): [number, number, number] {
  const s = l + c2 / 3;
  return [Math.exp(s + c1 / 2) - LOG_EPS, Math.exp(s - c1 / 2) - LOG_EPS, Math.exp(s - c2) - LOG_EPS];
}

const WEIGHTS = [W_BRIGHT, 1, 1];
/**
 * Glare lays white light over a sticker and pulls its chroma toward neutral. A sample may therefore be
 * explained as "colour k behind a veil of strength t" at the price VEIL_COST * t^2, which is cheap
 * enough to keep a washed-out orange orange and dear enough that a white sticker stays white.
 */
export const TUNING = { veilCost: 0.1, veilMax: 0.9 };
/** A channel at or above this is treated as clipped by the camera: its true value is at least what was read. */
const CLIP_LEVEL = 247;
/** How the feature moves when the log of one channel (R, G, B) goes up by one. */
const CHANNEL_DIRECTION = [
  [1 / 3, 1, 0.5],
  [1 / 3, -1, 0.5],
  [1 / 3, 0, -1],
];
const CHANNEL_NORM = CHANNEL_DIRECTION.map((u) => W_BRIGHT * (u[0] as number) ** 2 + (u[1] as number) ** 2 + (u[2] as number) ** 2);

/**
 * Squared distance of a residual to zero when the clipped channels (bit mask) may be raised by any
 * amount: a clipped orange reads yellower than it is, and this lets it still match orange. The
 * residual is updated in place to the completed one.
 */
function censoredCost(e: number[], clip: number): number {
  if (clip && clip !== 7) {
    const lift = [0, 0, 0];
    for (let pass = 0; pass < 2; pass++)
      for (let c = 0; c < 3; c++) {
        if (!(clip & (1 << c))) continue;
        const u = CHANNEL_DIRECTION[c] as number[];
        const slope = W_BRIGHT * (e[0] as number) * (u[0] as number) + (e[1] as number) * (u[1] as number) + (e[2] as number) * (u[2] as number);
        const next = Math.max(0, (lift[c] as number) - slope / (CHANNEL_NORM[c] as number));
        const d = next - (lift[c] as number);
        lift[c] = next;
        e[0] = (e[0] as number) + d * (u[0] as number);
        e[1] = (e[1] as number) + d * (u[1] as number);
        e[2] = (e[2] as number) + d * (u[2] as number);
      }
  }
  return W_BRIGHT * (e[0] as number) ** 2 + (e[1] as number) ** 2 + (e[2] as number) ** 2;
}

interface Fit {
  labels: Uint8Array;
  centres: Float64Array;
  /** n x 6 squared distance of every sample to every centre as that centre would look on the sample's face. */
  cost: Float64Array;
  objective: number;
}

function solve3(a: number[][], b: number[]): number[] {
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs((m[r] as number[])[c] as number) > Math.abs((m[p] as number[])[c] as number)) p = r;
    [m[c], m[p]] = [m[p] as number[], m[c] as number[]];
    const piv = (m[c] as number[])[c] as number;
    if (Math.abs(piv) < 1e-12) return [0, 0, 0];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = ((m[r] as number[])[c] as number) / piv;
      for (let k = c; k < 4; k++) (m[r] as number[])[k] = ((m[r] as number[])[k] as number) - f * ((m[c] as number[])[k] as number);
    }
  }
  return [0, 1, 2].map((i) => ((m[i] as number[])[3] as number) / ((m[i] as number[])[i] as number));
}

function fit(raw: Float64Array, clip: Uint8Array, weight: Float64Array, seed: Float64Array, compensate: boolean): Fit {
  /** The samples with clipped channels lifted to where their current colour says they were (starts as read). */
  const x = raw.slice();
  const centres = seed.slice();
  const offsets = new Float64Array(K * 3);
  const slopes = new Float64Array(K * 2);
  const sat = new Float64Array(K).fill(1);
  const cost = new Float64Array(N * K);
  /** The same, times the sample's weight: an unreliable sample has less say in where it goes, so it is the one that gives way. */
  const weighted = new Float64Array(N * K);
  const labels = new Uint8Array(N);
  const previous = new Uint8Array(N);
  const residual = [0, 0, 0];
  const lifts = new Float64Array(N * K * 3);
  let warm = false;
  for (let iter = 0; iter < 40; iter++) {
    for (let i = 0; i < N; i++) {
      const f = Math.floor(i / PER_FACE);
      const cell = i % PER_FACE;
      const u = ((cell % 6) + 0.5) / 6 - 0.5;
      const v = (Math.floor(cell / 6) + 0.5) / 6 - 0.5;
      const bright = (raw[i * 3] as number) - (offsets[f * 3] as number) - (slopes[f * 2] as number) * u - (slopes[f * 2 + 1] as number) * v;
      const s = sat[f] as number;
      for (let k = 0; k < K; k++) {
        const m1 = (offsets[f * 3 + 1] as number) + s * (centres[k * 3 + 1] as number);
        const m2 = (offsets[f * 3 + 2] as number) + s * (centres[k * 3 + 2] as number);
        const p1 = raw[i * 3 + 1] as number;
        const p2 = raw[i * 3 + 2] as number;
        const mm = m1 * m1 + m2 * m2;
        let veil = 0;
        if (TUNING.veilCost < 1e6 && mm > 1e-6) veil = Math.max(0, Math.min(TUNING.veilMax, ((1 - (p1 * m1 + p2 * m2) / mm) * mm) / (mm + TUNING.veilCost)));
        residual[0] = bright - (centres[k * 3] as number);
        residual[1] = p1 - (1 - veil) * m1;
        residual[2] = p2 - (1 - veil) * m2;
        const before0 = residual[0] as number;
        const before1 = p1 - m1;
        const before2 = p2 - m2;
        cost[i * K + k] = censoredCost(residual, clip[i] as number) + TUNING.veilCost * veil * veil;
        weighted[i * K + k] = (weight[i] as number) * (cost[i * K + k] as number);
        lifts[(i * K + k) * 3] = (residual[0] as number) - before0;
        lifts[(i * K + k) * 3 + 1] = (residual[1] as number) - before1;
        lifts[(i * K + k) * 3 + 2] = (residual[2] as number) - before2;
      }
    }
    previous.set(labels);
    balancedAssign(weighted, N, K, labels, warm);
    if (warm) {
      let same = true;
      for (let i = 0; i < N; i++)
        if (labels[i] !== previous[i]) {
          same = false;
          break;
        }
      if (same) break;
    }
    warm = true;
    for (let i = 0; i < N; i++) {
      const o = (i * K + (labels[i] as number)) * 3;
      for (let c = 0; c < 3; c++) x[i * 3 + c] = (raw[i * 3 + c] as number) + (lifts[o + c] as number);
    }
    // Centres: least-squares fit to the samples of each colour, given the per-face terms.
    const sum = new Float64Array(K * 3);
    const wsum = new Float64Array(K * 3);
    for (let i = 0; i < N; i++) {
      const k = labels[i] as number;
      const w = weight[i] as number;
      const f = Math.floor(i / PER_FACE);
      const cell = i % PER_FACE;
      const u = ((cell % 6) + 0.5) / 6 - 0.5;
      const v = (Math.floor(cell / 6) + 0.5) / 6 - 0.5;
      const s = sat[f] as number;
      sum[k * 3] = (sum[k * 3] as number) + w * ((x[i * 3] as number) - (offsets[f * 3] as number) - (slopes[f * 2] as number) * u - (slopes[f * 2 + 1] as number) * v);
      wsum[k * 3] = (wsum[k * 3] as number) + w;
      for (let c = 1; c < 3; c++) {
        sum[k * 3 + c] = (sum[k * 3 + c] as number) + w * s * ((x[i * 3 + c] as number) - (offsets[f * 3 + c] as number));
        wsum[k * 3 + c] = (wsum[k * 3 + c] as number) + w * s * s;
      }
    }
    // A colour nobody holds (possible only while some faces are missing) keeps its centre.
    for (let k = 0; k < K; k++) for (let c = 0; c < 3; c++) if ((wsum[k * 3 + c] as number) > 1e-9) centres[k * 3 + c] = (sum[k * 3 + c] as number) / (wsum[k * 3 + c] as number);
    if (!compensate) continue;
    // Per-face corrections: what the face's samples have in common after removing their colour centres.
    for (let f = 0; f < K; f++) {
      const a = [
        [RIDGE_BRIGHT, 0, 0],
        [0, RIDGE_SLOPE, 0],
        [0, 0, RIDGE_SLOPE],
      ];
      const b = [0, 0, 0];
      // Chroma: x = sat * centre + offset, unknowns [sat, offset1, offset2].
      const ca = [
        [RIDGE_SATURATION, 0, 0],
        [0, RIDGE_CHROMA, 0],
        [0, 0, RIDGE_CHROMA],
      ];
      const cb = [RIDGE_SATURATION, 0, 0];
      for (let cell = 0; cell < PER_FACE; cell++) {
        const i = f * PER_FACE + cell;
        const k = labels[i] as number;
        const w = weight[i] as number;
        const u = ((cell % 6) + 0.5) / 6 - 0.5;
        const v = (Math.floor(cell / 6) + 0.5) / 6 - 0.5;
        const basis = [1, u, v];
        const r0 = (x[i * 3] as number) - (centres[k * 3] as number);
        for (let p = 0; p < 3; p++) {
          b[p] = (b[p] as number) + w * (basis[p] as number) * r0;
          for (let q = 0; q < 3; q++) (a[p] as number[])[q] = ((a[p] as number[])[q] as number) + w * (basis[p] as number) * (basis[q] as number);
        }
        const m1 = centres[k * 3 + 1] as number;
        const m2 = centres[k * 3 + 2] as number;
        const x1 = x[i * 3 + 1] as number;
        const x2 = x[i * 3 + 2] as number;
        (ca[0] as number[])[0] = ((ca[0] as number[])[0] as number) + w * (m1 * m1 + m2 * m2);
        (ca[0] as number[])[1] = ((ca[0] as number[])[1] as number) + w * m1;
        (ca[0] as number[])[2] = ((ca[0] as number[])[2] as number) + w * m2;
        (ca[1] as number[])[0] = ((ca[1] as number[])[0] as number) + w * m1;
        (ca[1] as number[])[1] = ((ca[1] as number[])[1] as number) + w;
        (ca[2] as number[])[0] = ((ca[2] as number[])[0] as number) + w * m2;
        (ca[2] as number[])[2] = ((ca[2] as number[])[2] as number) + w;
        cb[0] = (cb[0] as number) + w * (x1 * m1 + x2 * m2);
        cb[1] = (cb[1] as number) + w * x1;
        cb[2] = (cb[2] as number) + w * x2;
      }
      const sol = solve3(a, b);
      offsets[f * 3] = sol[0] as number;
      slopes[f * 2] = sol[1] as number;
      slopes[f * 2 + 1] = sol[2] as number;
      const chroma = solve3(ca, cb);
      sat[f] = Math.max(0.25, Math.min(2.5, chroma[0] as number));
      offsets[f * 3 + 1] = chroma[1] as number;
      offsets[f * 3 + 2] = chroma[2] as number;
    }
  }
  let objective = 0;
  for (let i = 0; i < N; i++) objective += (weight[i] as number) * (cost[i * K + (labels[i] as number)] as number);
  for (let f = 0; f < K; f++) {
    objective += RIDGE_CHROMA * ((offsets[f * 3 + 1] as number) ** 2 + (offsets[f * 3 + 2] as number) ** 2) + RIDGE_SATURATION * ((sat[f] as number) - 1) ** 2;
    objective += W_BRIGHT * (RIDGE_BRIGHT * (offsets[f * 3] as number) ** 2 + RIDGE_SLOPE * ((slopes[f * 2] as number) ** 2 + (slopes[f * 2 + 1] as number) ** 2));
  }
  return { labels, centres, cost, objective };
}

function priorSeed(priors: readonly ColourPrior[], mean: Float64Array | null): Float64Array {
  const seed = new Float64Array(K * 3);
  const pm = [0, 0, 0];
  for (let k = 0; k < K; k++) {
    const p = (priors[k] as ColourPrior).rgb;
    colourFeature(p[0], p[1], p[2], seed, k * 3);
    for (let c = 0; c < 3; c++) pm[c] = (pm[c] as number) + (seed[k * 3 + c] as number) / K;
  }
  // Each colour appears 36 times, so the mean of all samples is the mean of the six centres plus the
  // overall light shift: moving the seeds by the difference cancels that shift.
  if (mean) for (let k = 0; k < K; k++) for (let c = 0; c < 3; c++) seed[k * 3 + c] = (seed[k * 3 + c] as number) + (mean[c] as number) - (pm[c] as number);
  return seed;
}

/** Seed from the data alone: start at the sample furthest from the mean, then keep taking the sample furthest from the seeds so far. */
function dataSeed(x: Float64Array, mean: Float64Array, weight: Float64Array): Float64Array {
  const seed = new Float64Array(K * 3);
  const dist = (i: number, c: ArrayLike<number>, o: number): number => {
    let d = 0;
    for (let j = 0; j < 3; j++) d += (WEIGHTS[j] as number) * ((x[i * 3 + j] as number) - (c[o + j] as number)) ** 2;
    return d;
  };
  const nearest = new Float64Array(N).fill(Infinity);
  let pick = 0;
  let far = -1;
  for (let i = 0; i < N; i++) {
    if (!(weight[i] as number)) continue;
    const d = dist(i, mean, 0);
    if (d > far) {
      far = d;
      pick = i;
    }
  }
  for (let k = 0; k < K; k++) {
    for (let c = 0; c < 3; c++) seed[k * 3 + c] = x[pick * 3 + c] as number;
    far = -1;
    let next = 0;
    for (let i = 0; i < N; i++) {
      if (!(weight[i] as number)) continue;
      nearest[i] = Math.min(nearest[i] as number, dist(i, seed, k * 3));
      if ((nearest[i] as number) > far) {
        far = nearest[i] as number;
        next = i;
      }
    }
    pick = next;
  }
  return seed;
}

const PERMS: number[][] = [];
(function build(p: number[], rest: number[]): void {
  if (!rest.length) {
    PERMS.push(p);
    return;
  }
  rest.forEach((v, i) => build([...p, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
})([], [0, 1, 2, 3, 4, 5]);

/**
 * Names the six centres and picks screen colours for them. asSeen (provisional readings of a few faces,
 * where the names are still guesses): the colours are what the camera saw with the exposure evened
 * out, not pulled toward the named shade and not pushed apart.
 */
function describe(centres: Float64Array, asSeen = false): { names: ColourName[]; palette: string[] } {
  let best: number[] = PERMS[0] as number[];
  let bestCost = Infinity;
  let bestSet = 0;
  let bestDist: number[] = [];
  const mean = new Float64Array(3);
  for (let k = 0; k < K; k++) for (let c = 0; c < 3; c++) mean[c] = (mean[c] as number) + (centres[k * 3 + c] as number) / K;
  COLOUR_PRIORS.forEach((priors, set) => {
    const proto = priorSeed(priors, mean);
    const d = new Float64Array(K * K);
    for (let k = 0; k < K; k++)
      for (let j = 0; j < K; j++) {
        let s = 0;
        for (let c = 0; c < 3; c++) s += (WEIGHTS[c] as number) * ((centres[k * 3 + c] as number) - (proto[j * 3 + c] as number)) ** 2;
        d[k * K + j] = s;
      }
    for (const perm of PERMS) {
      let s = 0;
      for (let k = 0; k < K; k++) s += d[k * K + (perm[k] as number)] as number;
      if (s < bestCost) {
        bestCost = s;
        best = perm;
        bestSet = set;
        bestDist = perm.map((j, k) => d[k * K + j] as number);
      }
    }
  });
  const priors = COLOUR_PRIORS[bestSet] as readonly ColourPrior[];
  const names: ColourName[] = [];
  const labs: [number, number, number][] = [];
  for (let k = 0; k < K; k++) {
    const prior = priors[best[k] as number] as ColourPrior;
    const named = (bestDist[k] as number) < 0.35;
    names.push(named ? prior.name : 'other');
    // Screen colour: what the camera saw, with the exposure normalised, pulled halfway to the usual shade when the colour has a name.
    let rgb = featureToRgb(centres[k * 3] as number, centres[k * 3 + 1] as number, centres[k * 3 + 2] as number);
    const top = Math.max(rgb[0], rgb[1], rgb[2], 1);
    const gain = Math.min(4, 235 / top);
    rgb = [Math.max(0, rgb[0] * gain), Math.max(0, rgb[1] * gain), Math.max(0, rgb[2] * gain)];
    const seen = rgbToLab(Math.min(255, rgb[0]), Math.min(255, rgb[1]), Math.min(255, rgb[2]));
    if (named && !asSeen) {
      const want = rgbToLab(prior.display[0], prior.display[1], prior.display[2]);
      labs.push([(seen[0] + want[0]) / 2, (seen[1] + want[1]) / 2, (seen[2] + want[2]) / 2]);
    } else {
      labs.push(seen);
    }
  }
  // Push apart any two screen colours that would be hard to tell apart.
  for (let round = 0; round < (asSeen ? 0 : 20); round++) {
    let moved = false;
    for (let a = 0; a < K; a++)
      for (let b = a + 1; b < K; b++) {
        const la = labs[a] as [number, number, number];
        const lb = labs[b] as [number, number, number];
        const d = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
        if (d >= 28) continue;
        const dir = d < 1e-3 ? [1, 0, 0] : [(la[0] - lb[0]) / d, (la[1] - lb[1]) / d, (la[2] - lb[2]) / d];
        const push = (28 - d) / 2 + 0.5;
        for (let c = 0; c < 3; c++) {
          la[c] = (la[c] as number) + (dir[c] as number) * push;
          lb[c] = (lb[c] as number) - (dir[c] as number) * push;
        }
        la[0] = Math.max(8, Math.min(97, la[0]));
        lb[0] = Math.max(8, Math.min(97, lb[0]));
        moved = true;
      }
    if (!moved) break;
  }
  const palette = labs.map((l) => {
    const rgb = labToRgb(l[0], l[1], l[2]);
    return rgbToCss(rgb[0], rgb[1], rgb[2]);
  });
  return { names, palette };
}

export interface ClassifyOptions {
  /** Fit per-face lighting corrections (default true). Off is only useful for measuring what they buy. */
  compensate?: boolean;
}

/** Six faces in U R F D L B order, each row-major as read in CONVENTIONS.md. */
export function classifyCube(faces: readonly FaceSample[], options: ClassifyOptions = {}): Classification {
  if (faces.length !== K) throw new Error('classifyCube needs six faces, got ' + faces.length);
  return classifyFaces(faces, options);
}

/**
 * The fit behind classifyCube and classifyPartial. A missing face (null) contributes 36 samples of
 * weight zero that cost nothing wherever they go, so the rule "36 stickers per colour" becomes "at
 * most 36 per colour" for the faces that are there, and the same code serves both cases.
 */
function classifyFaces(faces: readonly (FaceSample | null)[], options: ClassifyOptions): Classification {
  const x = new Float64Array(N * 3);
  const weight = new Float64Array(N);
  const clip = new Uint8Array(N);
  const mean = new Float64Array(3);
  let wsum = 0;
  let present = 0;
  for (let f = 0; f < K; f++) {
    const face = faces[f];
    if (!face) continue;
    present++;
    if (face.rgb.length < PER_FACE * 3) throw new Error('face ' + f + ' has no 36 samples');
    for (let cell = 0; cell < PER_FACE; cell++) {
      const i = f * PER_FACE + cell;
      colourFeature(face.rgb[cell * 3] as number, face.rgb[cell * 3 + 1] as number, face.rgb[cell * 3 + 2] as number, x, i * 3);
      for (let c = 0; c < 3; c++) if ((face.rgb[cell * 3 + c] as number) >= CLIP_LEVEL) clip[i] = (clip[i] as number) | (1 << c);
      const q = face.quality ? (face.quality[cell] as number) : 1;
      weight[i] = 0.15 + 0.85 * Math.max(0, Math.min(1, Number.isFinite(q) ? q : 0));
      for (let c = 0; c < 3; c++) {
        if (!Number.isFinite(x[i * 3 + c] as number)) x[i * 3 + c] = 0;
        mean[c] = (mean[c] as number) + (x[i * 3 + c] as number);
      }
      wsum += 1;
    }
  }
  if (!present) throw new Error('no face to classify');
  for (let c = 0; c < 3; c++) mean[c] = (mean[c] as number) / wsum;
  const complete = present === K;
  const compensate = options.compensate !== false;
  const seeds: Float64Array[] = [];
  for (const priors of COLOUR_PRIORS) {
    // The mean of all samples says how the light is shifted when every colour is present equally often:
    // exact for a whole cube, a rough guess for a few faces, and the fit keeps whichever seed ends best.
    seeds.push(priorSeed(priors, mean));
    seeds.push(priorSeed(priors, null));
  }
  seeds.push(dataSeed(x, mean, weight));
  let best: Fit | null = null;
  for (const seed of seeds) {
    const f = fit(x, clip, weight, seed, compensate);
    if (!best || f.objective < best.objective) best = f;
  }
  const result = best as Fit;
  // Costs relative to the typical distance of a sample to its own centre.
  const raw = result.cost;
  const ownList: number[] = [];
  for (let i = 0; i < N; i++) if (weight[i] as number) ownList.push(raw[i * K + (result.labels[i] as number)] as number);
  ownList.sort((a, b) => a - b);
  const scale = Math.max(1e-4, (ownList[Math.floor(ownList.length * 0.5)] as number) * 2.2);
  const costs = new Float32Array(N * K);
  const confidence = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!(weight[i] as number)) continue;
    let total = 0;
    for (let k = 0; k < K; k++) {
      costs[i * K + k] = (raw[i * K + k] as number) / scale;
      total += Math.exp(-0.5 * (costs[i * K + k] as number));
    }
    const mine = Math.exp(-0.5 * (costs[i * K + (result.labels[i] as number)] as number));
    const fitTerm = Math.exp(-(costs[i * K + (result.labels[i] as number)] as number) / 40);
    const q = (weight[i] as number - 0.15) / 0.85;
    // A sample that is mostly glare or mixed pixels cannot be trusted whatever it looks like.
    confidence[i] = Math.max(0, Math.min(1, (total > 0 ? mine / total : 0) * fitTerm * Math.min(1, 0.1 + 1.8 * q)));
  }
  const { names, palette } = describe(result.centres, !complete);
  return { labels: result.labels, confidence, costs, palette, names };
}

/** A sticker is shown as "unsure" when its confidence is below this. See docs/vision-report.md (Version 2) for what the flag catches. */
export const UNSURE_BELOW = 0.7;

export interface PartialFace {
  /** 36 colour group ids 0..5, row-major. Stickers with the same id were read as the same colour. */
  groups: Uint8Array;
  /** 36 values 0..1. */
  confidence: Float32Array;
}

export interface PartialClassification {
  /** One entry per slot given: null where no face was given. */
  faces: (PartialFace | null)[];
  /** CSS colour per group id. */
  palette: string[];
  /** Best-guess name per group id. */
  names: ColourName[];
  /** All six faces were given: the groups are exactly the labels of classifyCube. */
  complete: boolean;
}

/**
 * Provisional reading of the faces captured so far: six slots in U R F D L B order, null for a face
 * that has not been captured. With one face it can only group stickers that look alike; every further
 * face steadies the lighting correction and the colour centres; with all six it is classifyCube.
 */
export function classifyPartial(faces: readonly (FaceSample | null)[], options: ClassifyOptions = {}): PartialClassification {
  if (faces.length !== K) throw new Error('classifyPartial needs six slots (null for a missing face), got ' + faces.length);
  const out: (PartialFace | null)[] = [null, null, null, null, null, null];
  if (!faces.some(Boolean)) return { faces: out, palette: COLOUR_PRIORS[0]!.map((p) => rgbToCss(p.display[0], p.display[1], p.display[2])), names: COLOUR_PRIORS[0]!.map((p) => p.name), complete: false };
  const result = classifyFaces(faces, options);
  for (let f = 0; f < K; f++) {
    if (!faces[f]) continue;
    out[f] = { groups: result.labels.slice(f * PER_FACE, (f + 1) * PER_FACE), confidence: result.confidence.slice(f * PER_FACE, (f + 1) * PER_FACE) };
  }
  return { faces: out, palette: result.palette, names: result.names, complete: faces.every(Boolean) };
}
