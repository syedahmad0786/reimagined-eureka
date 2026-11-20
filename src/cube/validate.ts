/**
 * Checks that 216 sticker colours describe a real cube, and says what is wrong when they do not.
 *
 * A valid state has 36 stickers of each colour, eight corner pieces that fit one colour scheme with no
 * net twist, 24 distinct outer and 24 distinct inner edge wings, and four of each colour in each of the
 * four centre orbits. Every such state can be solved (the solver run is the final proof).
 */
import { NF, NN, N, FACE_NAMES } from './geometry';
import { CORNERS, WINGS, CENTRES, CENTRE_ORBIT_NAMES, EDGES } from './pieces';
import { deriveScheme, cornerTwist, analyseWings, colourCounts, type Scheme } from './scheme';

export type ProblemKind = 'unknown' | 'count' | 'corner' | 'twist' | 'edge' | 'centre';

export interface Problem {
  kind: ProblemKind;
  message: string;
  /** Stickers to highlight. */
  facelets: number[];
}

export interface Validation {
  ok: boolean;
  problems: Problem[];
  /** Every sticker involved in some problem. */
  suspects: number[];
}

const DEFAULT_NAMES = ['colour 1', 'colour 2', 'colour 3', 'colour 4', 'colour 5', 'colour 6'];

function plural(n: number, word: string): string {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

export function validateState(state: ArrayLike<number>, names: readonly string[] = DEFAULT_NAMES): Validation {
  const problems: Problem[] = [];
  const name = (c: number): string => names[c] ?? 'colour ' + (c + 1);

  const unknown: number[] = [];
  for (let i = 0; i < NF; i++) if ((state[i] as number) > 5) unknown.push(i);
  if (unknown.length) {
    problems.push({ kind: 'unknown', message: plural(unknown.length, 'sticker') + ' still ' + (unknown.length === 1 ? 'has' : 'have') + ' no colour.', facelets: unknown });
    return { ok: false, problems, suspects: unknown };
  }

  const counts = colourCounts(state);
  const over = counts.map((c, i) => (c > 36 ? name(i) + ' ' + c : '')).filter(Boolean);
  const under = counts.map((c, i) => (c < 36 ? name(i) + ' ' + c : '')).filter(Boolean);
  if (over.length || under.length) {
    problems.push({
      kind: 'count',
      message: 'Each colour must appear 36 times. Too many: ' + (over.join(', ') || 'none') + '. Too few: ' + (under.join(', ') || 'none') + '.',
      facelets: [],
    });
  }

  const sr = deriveScheme(state);
  const scheme = sr.scheme;
  if (sr.badCorners.length) {
    const facelets = sr.badCorners.flatMap((i) => (CORNERS[i] as (typeof CORNERS)[number]).facelets);
    const where = sr.badCorners.map((i) => cornerName(i)).join('; ');
    problems.push({
      kind: 'corner',
      message:
        plural(sr.badCorners.length, 'corner piece') +
        (sr.badCorners.length === 1 ? ' does' : ' do') +
        ' not fit the colour scheme of the other corners (wrong colours, or the same piece twice): ' +
        where +
        '.',
      facelets,
    });
  } else if (scheme && cornerTwist(state, scheme) !== 0) {
    problems.push({
      kind: 'twist',
      message:
        'All eight corners are real pieces, but one is twisted in place. Check that each corner sticker is on the right face of its corner; if the grid matches your cube, one corner of the cube itself has been twisted and needs to be turned back by hand.',
      facelets: CORNERS.flatMap((c) => c.facelets),
    });
  }

  if (scheme) {
    const wings = analyseWings(state, scheme);
    if (!wings.valid) {
      for (const orbit of [0, 1]) {
        const kind = orbit === 0 ? 'outer' : 'inner';
        const slots = wings.badSlots.filter((s) => (WINGS[s] as (typeof WINGS)[number]).orbit === orbit);
        const missing = wings.missing.filter((m) => m[0] === orbit);
        if (!slots.length && !missing.length) continue;
        const impossible: number[] = [];
        const duplicate: number[] = [];
        for (const s of slots) {
          const w = WINGS[s] as (typeof WINGS)[number];
          const a = state[w.facelets[0]] as number;
          const b = state[w.facelets[1]] as number;
          if (a === b || scheme.opposite[a] === b) impossible.push(s);
          else duplicate.push(s);
        }
        const parts: string[] = [];
        if (impossible.length) parts.push(plural(impossible.length, 'piece') + ' with two colours that never share an edge (' + impossible.map((s) => wingName(s, state, name)).join('; ') + ')');
        if (duplicate.length) parts.push('the same piece more than once (' + duplicate.map((s) => wingName(s, state, name)).join('; ') + ')');
        if (missing.length) parts.push('missing: ' + missing.slice(0, 6).map((m) => name(m[1]) + '/' + name(m[2])).join(', ') + (missing.length > 6 ? ' and ' + (missing.length - 6) + ' more' : ''));
        problems.push({
          kind: 'edge',
          message: 'The ' + kind + ' edge pieces (' + (orbit === 0 ? 'second and fifth' : 'third and fourth') + ' sticker along each edge) are not a valid set: ' + parts.join('; ') + '.',
          facelets: slots.flatMap((s) => (WINGS[s] as (typeof WINGS)[number]).facelets),
        });
      }
    }
  }

  for (let orbit = 0; orbit < 4; orbit++) {
    const c = new Array<number>(6).fill(0);
    const slots = CENTRES.filter((x) => x.orbit === orbit);
    for (const s of slots) c[state[s.facelet] as number] = (c[state[s.facelet] as number] as number) + 1;
    if (c.every((v) => v === 4)) continue;
    const tooMany = c.map((v, i) => (v > 4 ? i : -1)).filter((i) => i >= 0);
    const detail = c
      .map((v, i) => (v !== 4 ? name(i) + ' ' + v : ''))
      .filter(Boolean)
      .join(', ');
    problems.push({
      kind: 'centre',
      message: 'The ' + CENTRE_ORBIT_NAMES[orbit] + ' need four of each colour, but have ' + detail + '. One of the highlighted stickers is probably wrong.',
      facelets: slots.filter((s) => tooMany.includes(state[s.facelet] as number)).map((s) => s.facelet),
    });
  }

  const suspects = Array.from(new Set(problems.flatMap((p) => p.facelets))).sort((a, b) => a - b);
  return { ok: problems.length === 0, problems, suspects };
}

function cornerName(i: number): string {
  const c = CORNERS[i] as (typeof CORNERS)[number];
  return c.faces.map((f) => FACE_NAMES[f]).join('-') + ' corner';
}

function wingName(slot: number, state: ArrayLike<number>, name: (c: number) => string): string {
  const w = WINGS[slot] as (typeof WINGS)[number];
  const e = EDGES[w.edge] as (typeof EDGES)[number];
  return name(state[w.facelets[0]] as number) + '/' + name(state[w.facelets[1]] as number) + ' on the ' + FACE_NAMES[e.faces[0]] + '-' + FACE_NAMES[e.faces[1]] + ' edge';
}

/** A number that is 0 exactly for valid states and grows with the amount that is wrong. */
export function badness(state: ArrayLike<number>, fixedScheme?: Scheme | null): number {
  for (let i = 0; i < NF; i++) if ((state[i] as number) > 5) return 1000;
  let score = 0;
  const counts = colourCounts(state);
  for (const c of counts) score += Math.abs(c - 36);
  let scheme = fixedScheme ?? null;
  if (!scheme) {
    const sr = deriveScheme(state);
    scheme = sr.scheme;
    score += sr.badCorners.length * 3;
    if (!scheme) return score + 50;
    if (sr.badCorners.length === 0 && cornerTwist(state, scheme) !== 0) score += 2;
  }
  const wings = analyseWings(state, scheme);
  score += wings.badSlots.length + wings.missing.length;
  for (let orbit = 0; orbit < 4; orbit++) {
    const c = [0, 0, 0, 0, 0, 0];
    for (const s of CENTRES) if (s.orbit === orbit) c[state[s.facelet] as number] = (c[state[s.facelet] as number] as number) + 1;
    for (const v of c) score += Math.abs(v - 4);
  }
  return score;
}

export interface Suggestion {
  description: string;
  changes: { facelet: number; colour: number }[];
  /** True when applying it makes the whole state valid. */
  solves: boolean;
  /** Lower is more plausible (uses the scanner's own second choices when available). */
  cost: number;
}

function rotateFaceCopy(state: ArrayLike<number>, face: number, quarters: number): Uint8Array {
  const out = Uint8Array.from(state as ArrayLike<number>);
  for (let k = 0; k < quarters; k++) {
    const old = out.slice(face * NN, face * NN + NN);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) out[face * NN + r * N + c] = old[(N - 1 - c) * N + r] as number;
  }
  return out;
}

const CORNER_FACELET = new Uint8Array(NF);
for (const c of CORNERS) for (const f of c.facelets) CORNER_FACELET[f] = 1;

/**
 * Looks for the smallest edit that repairs an invalid state: one sticker recoloured, two stickers
 * swapped, or one face turned (a photo taken with the cube held the wrong way up).
 * costs is the scanner's 216 x 6 cost table when the state came from photos.
 */
export function suggestFixes(state: ArrayLike<number>, names: readonly string[] = DEFAULT_NAMES, costs?: ArrayLike<number>, limit = 4): Suggestion[] {
  const base = badness(state);
  if (base === 0 || base >= 1000) return [];
  const out: Suggestion[] = [];
  const name = (c: number): string => names[c] ?? 'colour ' + (c + 1);
  const where = (f: number): string => FACE_NAMES[Math.floor(f / NN)] + ' face, row ' + (Math.floor((f % NN) / N) + 1) + ', column ' + ((f % N) + 1);
  const changeCost = (f: number, to: number): number => (costs ? (costs[f * 6 + to] as number) - (costs[f * 6 + (state[f] as number)] as number) : 1);

  // A face photographed in the wrong orientation.
  for (let face = 0; face < 6; face++)
    for (let q = 1; q <= 3; q++) {
      const cand = rotateFaceCopy(state, face, q);
      if (badness(cand) === 0) {
        const changes: Suggestion['changes'] = [];
        for (let i = face * NN; i < face * NN + NN; i++) if (cand[i] !== state[i]) changes.push({ facelet: i, colour: cand[i] as number });
        out.push({
          description: 'Turn the ' + FACE_NAMES[face] + ' face ' + (q === 2 ? 'upside down' : q === 1 ? 'a quarter turn clockwise' : 'a quarter turn anticlockwise') + ' (it looks like it was photographed in a different orientation).',
          changes,
          solves: true,
          cost: 0.5,
        });
      }
    }

  const counts = colourCounts(state);
  const work = Uint8Array.from(state as ArrayLike<number>);
  const scheme = deriveScheme(state).scheme;
  const evalCand = (touchesCorner: boolean): number => badness(work, touchesCorner ? null : scheme);
  const cands: Suggestion[] = [];
  if (counts.some((c) => c !== 36)) {
    // Recolour one sticker from an over-represented colour to an under-represented one.
    for (let f = 0; f < NF; f++) {
      const from = state[f] as number;
      if ((counts[from] as number) <= 36) continue;
      for (let to = 0; to < 6; to++) {
        if ((counts[to] as number) >= 36) continue;
        work[f] = to;
        const b = evalCand(CORNER_FACELET[f] === 1);
        work[f] = from;
        if (b < base) cands.push({ description: 'Change the ' + where(f) + ' sticker from ' + name(from) + ' to ' + name(to) + '.', changes: [{ facelet: f, colour: to }], solves: b === 0, cost: changeCost(f, to) + b * 10 });
      }
    }
  } else {
    for (let a = 0; a < NF; a++)
      for (let b2 = a + 1; b2 < NF; b2++) {
        const ca = state[a] as number;
        const cb = state[b2] as number;
        if (ca === cb) continue;
        work[a] = cb;
        work[b2] = ca;
        const b = evalCand(CORNER_FACELET[a] === 1 || CORNER_FACELET[b2] === 1);
        work[a] = ca;
        work[b2] = cb;
        if (b === 0)
          cands.push({
            description: 'Swap two stickers: ' + where(a) + ' (' + name(ca) + ') and ' + where(b2) + ' (' + name(cb) + ').',
            changes: [
              { facelet: a, colour: cb },
              { facelet: b2, colour: ca },
            ],
            solves: true,
            cost: changeCost(a, cb) + changeCost(b2, ca),
          });
      }
  }
  cands.sort((x, y) => Number(y.solves) - Number(x.solves) || x.cost - y.cost);
  for (const c of cands) {
    if (out.length >= limit) break;
    out.push(c);
  }
  return out.slice(0, limit);
}
