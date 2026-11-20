/**
 * Colour scheme and piece identity.
 *
 * A 6x6x6 has no fixed centres, so which colour belongs opposite which, and the handedness of the
 * colour arrangement, are read from the eight corner pieces. Everything here works for any six colours.
 */
import { NF, U, R, F, D, L, B } from './geometry';
import { CORNERS, WINGS } from './pieces';
import { ROTATIONS } from './rotations';

export interface Scheme {
  /** opposite[colour] = the colour on the opposite side of the cube. */
  opposite: number[];
  /** One valid way to put colours on faces: base[face] = colour. */
  base: number[];
  /** All 24 valid arrangements (rotations of base): assignments[k][face] = colour. */
  assignments: number[][];
}

/** Colours of the three stickers of each corner slot, clockwise. */
export function readCorners(state: ArrayLike<number>): [number, number, number][] {
  return CORNERS.map((c) => c.facelets.map((f) => state[f] as number) as [number, number, number]);
}

function canonicalTriple(t: readonly number[]): string {
  // Rotate so the smallest colour comes first; keeps the cyclic (clockwise) order.
  const k = t.indexOf(Math.min(...t));
  return [t[k], t[(k + 1) % 3], t[(k + 2) % 3]].join('-');
}

export interface SchemeResult {
  scheme: Scheme | null;
  /** Human-readable problems, empty when the corners form a consistent scheme. */
  problems: string[];
  /** Corner slots (0..7) that do not fit, when a scheme could still be guessed. */
  badCorners: number[];
}

/**
 * Derive the colour scheme from the corners. Tries every corner as the reference so that one misread
 * corner does not hide the scheme the other seven agree on.
 */
export function deriveScheme(state: ArrayLike<number>): SchemeResult {
  const corners = readCorners(state);
  let best: { scheme: Scheme; bad: number[] } | null = null;
  for (let ref = 0; ref < 8; ref++) {
    const t = corners[ref] as [number, number, number];
    if (new Set(t).size !== 3) continue;
    for (let twist = 0; twist < 3; twist++) {
      // Assume corner slot ref is correct up to twist; its colours fix three faces.
      const faces = (CORNERS[ref] as (typeof CORNERS)[number]).faces;
      const base = new Array<number>(6).fill(-1);
      for (let k = 0; k < 3; k++) base[faces[k] as number] = t[(k + twist) % 3] as number;
      const rest = [0, 1, 2, 3, 4, 5].filter((c) => !base.includes(c));
      if (rest.length !== 3) continue;
      const missingFaces = [0, 1, 2, 3, 4, 5].filter((f) => base[f] === -1);
      // Try the six ways to place the three remaining colours on the three remaining faces.
      const perms = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ];
      for (const p of perms) {
        const b = base.slice();
        for (let k = 0; k < 3; k++) b[missingFaces[k] as number] = rest[p[k] as number] as number;
        const expected = new Map<string, number>();
        CORNERS.forEach((c, i) => expected.set(canonicalTriple(c.faces.map((f) => b[f] as number)), i));
        const used = new Set<string>();
        const bad: number[] = [];
        corners.forEach((c, i) => {
          const key = canonicalTriple(c);
          if (!expected.has(key) || used.has(key)) bad.push(i);
          used.add(key);
        });
        if (!best || bad.length < best.bad.length) {
          const opposite = new Array<number>(6).fill(-1);
          opposite[b[U] as number] = b[D] as number;
          opposite[b[D] as number] = b[U] as number;
          opposite[b[R] as number] = b[L] as number;
          opposite[b[L] as number] = b[R] as number;
          opposite[b[F] as number] = b[B] as number;
          opposite[b[B] as number] = b[F] as number;
          const assignments = ROTATIONS.map((rot) => {
            const a = new Array<number>(6);
            for (let f = 0; f < 6; f++) a[rot.faceTo[f] as number] = b[f] as number;
            return a;
          });
          best = { scheme: { opposite, base: b, assignments }, bad };
          if (bad.length === 0) return { scheme: best.scheme, problems: [], badCorners: [] };
        }
      }
    }
  }
  if (!best) return { scheme: null, problems: ['The corner pieces do not show three different colours each.'], badCorners: [0, 1, 2, 3, 4, 5, 6, 7] };
  return {
    scheme: best.bad.length <= 2 ? best.scheme : null,
    problems: [best.bad.length + ' corner piece(s) do not fit one colour scheme.'],
    badCorners: best.bad,
  };
}

/** Sum of corner twists modulo 3 under an assignment; 0 for a reachable state. */
export function cornerTwist(state: ArrayLike<number>, scheme: Scheme): number {
  const ud = [scheme.base[U] as number, scheme.base[D] as number];
  let sum = 0;
  for (const c of CORNERS) {
    const k = c.facelets.findIndex((f) => ud.includes(state[f] as number));
    if (k < 0) return -1;
    sum += k;
  }
  return sum % 3;
}

/**
 * Home slot of every wing piece under an assignment: wingHome(assignment)[orbit][c1 * 6 + c2] is the
 * wing slot (index into WINGS) where the piece with handed colours (c1, c2) belongs, or -1.
 */
export function wingHomes(assignment: readonly number[]): Int8Array[] {
  const faceOfColour = new Array<number>(6);
  for (let f = 0; f < 6; f++) faceOfColour[assignment[f] as number] = f;
  const out = [new Int8Array(36).fill(-1), new Int8Array(36).fill(-1)];
  WINGS.forEach((w, i) => {
    const f1 = Math.floor(w.handed[0] / 36);
    const f2 = Math.floor(w.handed[1] / 36);
    (out[w.orbit] as Int8Array)[(assignment[f1] as number) * 6 + (assignment[f2] as number)] = i;
  });
  return out;
}

export interface WingReport {
  /** [outer orbit, inner orbit]: true when the permutation of that orbit is odd. */
  odd: [boolean, boolean];
  /** True when each orbit holds each of its 24 pieces exactly once. */
  valid: boolean;
  /** Wing slots whose piece is impossible or duplicated. */
  badSlots: number[];
  /** Pieces that are missing, as [orbit, colour1, colour2] in handed order. */
  missing: [number, number, number][];
}

export function analyseWings(state: ArrayLike<number>, scheme: Scheme): WingReport {
  const homes = wingHomes(scheme.base);
  const homeOfSlot = new Int16Array(WINGS.length).fill(-1);
  const seen: number[][] = [new Array(36).fill(-1), new Array(36).fill(-1)];
  const bad = new Set<number>();
  WINGS.forEach((w, i) => {
    const key = (state[w.handed[0]] as number) * 6 + (state[w.handed[1]] as number);
    const home = (homes[w.orbit] as Int8Array)[key] as number;
    if (home < 0) {
      bad.add(i);
      return;
    }
    const prev = (seen[w.orbit] as number[])[key] as number;
    if (prev >= 0) {
      bad.add(i);
      bad.add(prev);
      return;
    }
    (seen[w.orbit] as number[])[key] = i;
    homeOfSlot[i] = home;
  });
  const missing: [number, number, number][] = [];
  for (let orbit = 0; orbit < 2; orbit++)
    for (let key = 0; key < 36; key++)
      if (((homes[orbit] as Int8Array)[key] as number) >= 0 && ((seen[orbit] as number[])[key] as number) < 0) missing.push([orbit, Math.floor(key / 6), key % 6]);
  const odd: [boolean, boolean] = [false, false];
  if (bad.size === 0) {
    const visited = new Uint8Array(WINGS.length);
    for (let i = 0; i < WINGS.length; i++) {
      if (visited[i]) continue;
      let len = 0;
      let j = i;
      while (!visited[j]) {
        visited[j] = 1;
        j = homeOfSlot[j] as number;
        len++;
      }
      if (len % 2 === 0) {
        const orbit = (WINGS[i] as (typeof WINGS)[number]).orbit;
        odd[orbit] = !odd[orbit];
      }
    }
  }
  return { odd, valid: bad.size === 0 && missing.length === 0, badSlots: Array.from(bad).sort((a, b) => a - b), missing };
}

export function colourCounts(state: ArrayLike<number>): number[] {
  const counts = new Array<number>(6).fill(0);
  for (let i = 0; i < NF; i++) {
    const c = state[i] as number;
    if (c >= 0 && c < 6) counts[c] = (counts[c] as number) + 1;
  }
  return counts;
}

/** Colour scheme of a cube whose face f is colour f. */
export function standardScheme(): Scheme {
  const s = new Uint8Array(NF);
  for (let i = 0; i < NF; i++) s[i] = Math.floor(i / 36);
  return deriveScheme(s).scheme as Scheme;
}

void R;
void F;
void L;
void B;
