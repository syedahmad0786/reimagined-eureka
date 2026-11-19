/**
 * Moves and the move engine used by the solver and the app.
 *
 * A Move turns the block of layers lo..hi (cubie coordinate along `axis`, inclusive) by q quarter
 * turns clockwise as seen from the positive end of the axis (that is, in the direction of R for the
 * x axis, U for the y axis, F for the z axis).
 *
 * Permutations here are derived geometrically, by rotating every sticker's position and normal.
 * src/cube/reference.ts holds a second, independently written engine that the tests compare against.
 */
import { N, NF, NN, FACE_NORMALS, faceletCubie, cubieFaceletIndex, faceOfNormal, type Vec3 } from './geometry';

export type Axis = 0 | 1 | 2;

export interface Move {
  axis: Axis;
  /** First layer of the block, 0..5 along the axis. */
  lo: number;
  /** Last layer of the block, lo..5. */
  hi: number;
  /** Quarter turns clockwise seen from the positive end of the axis: 1, 2 or 3. */
  q: number;
}

function rotateVec(axis: Axis, v: Vec3): Vec3 {
  if (axis === 0) return [v[0], v[2], -v[1]];
  if (axis === 1) return [-v[2], v[1], v[0]];
  return [v[1], -v[0], v[2]];
}

/** perm[i] = j means: after the turn, facelet i shows what facelet j showed before. */
function quarterLayerPerm(axis: Axis, layer: number): Uint8Array {
  const perm = new Uint8Array(NF);
  const m = N - 1;
  for (let j = 0; j < NF; j++) {
    const face = Math.floor(j / NN);
    const row = Math.floor((j % NN) / N);
    const col = j % N;
    const cubie = faceletCubie(face, row, col);
    if (cubie[axis] !== layer) continue;
    const centred: Vec3 = [2 * cubie[0] - m, 2 * cubie[1] - m, 2 * cubie[2] - m];
    const p = rotateVec(axis, centred);
    const n = rotateVec(axis, FACE_NORMALS[face] as Vec3);
    const i = cubieFaceletIndex(faceOfNormal(n), (p[0] + m) / 2, (p[1] + m) / 2, (p[2] + m) / 2);
    perm[i] = j;
  }
  for (let j = 0; j < NF; j++) {
    const face = Math.floor(j / NN);
    const cubie = faceletCubie(face, Math.floor((j % NN) / N), j % N);
    if (cubie[axis] !== layer) perm[j] = j;
  }
  return perm;
}

/** Compose pull-permutations: result = apply a, then b. */
export function composePerm(a: ArrayLike<number>, b: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[b[i] as number] as number;
  return out;
}

export function identityPerm(n = NF): Uint8Array {
  const p = new Uint8Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  return p;
}

const permCache = new Map<number, Uint8Array>();

export function moveKey(m: Move): number {
  return ((m.axis * 6 + m.lo) * 6 + m.hi) * 4 + (m.q & 3);
}

/** Facelet permutation of a move, in pull form: next[i] = prev[perm[i]]. Cached. */
export function movePerm(m: Move): Uint8Array {
  const key = moveKey(m);
  let p = permCache.get(key);
  if (p) return p;
  if (m.lo < 0 || m.hi >= N || m.lo > m.hi || m.q < 1 || m.q > 3) throw new Error('bad move ' + JSON.stringify(m));
  let quarter = identityPerm();
  for (let layer = m.lo; layer <= m.hi; layer++) quarter = composePerm(quarter, quarterLayerPerm(m.axis, layer));
  p = quarter;
  for (let k = 1; k < m.q; k++) p = composePerm(p, quarter);
  permCache.set(key, p);
  return p;
}

export function applyPerm<T extends Uint8Array>(state: T, perm: ArrayLike<number>): T {
  const out = new Uint8Array(state.length) as T;
  for (let i = 0; i < state.length; i++) out[i] = state[perm[i] as number] as number;
  return out;
}

export function applyMove(state: Uint8Array, m: Move): Uint8Array {
  return applyPerm(state, movePerm(m));
}

export function applyMoves(state: Uint8Array, moves: readonly Move[]): Uint8Array {
  let s = state;
  for (const m of moves) s = applyMove(s, m);
  return s;
}

export function invertMove(m: Move): Move {
  return { axis: m.axis, lo: m.lo, hi: m.hi, q: (4 - m.q) & 3 };
}

export function invertMoves(moves: readonly Move[]): Move[] {
  return moves.map(invertMove).reverse();
}

export function sameMove(a: Move, b: Move): boolean {
  return a.axis === b.axis && a.lo === b.lo && a.hi === b.hi && a.q === b.q;
}

/** True when the block lies entirely in one half of the cube, so it can be named from one outer face. */
export function isNameable(m: Move): boolean {
  return m.lo >= N / 2 || m.hi < N / 2;
}

const POSITIVE_FACE = ['R', 'U', 'F'];
const NEGATIVE_FACE = ['L', 'D', 'B'];

export interface MoveInfo {
  /** Face letter the move is named from. */
  face: string;
  /** Layers counted from that face, 1 = the outer layer. */
  fromLayer: number;
  toLayer: number;
  /** Quarter turns clockwise as seen when looking at that face: 1, 2 or 3. */
  clockwise: number;
}

/** Describes a move from the point of view of the outer face it is named from. */
export function describeMove(m: Move): MoveInfo {
  const positive = m.lo >= N / 2 || (m.hi >= N / 2 && N - 1 - m.hi <= m.lo);
  if (positive) {
    return { face: POSITIVE_FACE[m.axis] as string, fromLayer: N - m.hi, toLayer: N - m.lo, clockwise: m.q };
  }
  return { face: NEGATIVE_FACE[m.axis] as string, fromLayer: m.lo + 1, toLayer: m.hi + 1, clockwise: (4 - m.q) & 3 };
}

/**
 * Standard big-cube notation.
 *   R        the outer layer            Rw       the two outer layers      3Rw     the three outer layers
 *   2R, 3R   a single inner layer       2-3Rw    inner layers 2 to 3 together
 * A trailing ' is anticlockwise and a trailing 2 is a half turn, both judged looking at the named face.
 */
export function moveToString(m: Move): string {
  const d = describeMove(m);
  const suffix = d.clockwise === 1 ? '' : d.clockwise === 2 ? '2' : "'";
  let body: string;
  if (d.fromLayer === 1) {
    body = d.toLayer === 1 ? d.face : d.toLayer === 2 ? d.face + 'w' : d.toLayer + d.face + 'w';
  } else if (d.fromLayer === d.toLayer) {
    body = d.fromLayer + d.face;
  } else {
    body = d.fromLayer + '-' + d.toLayer + d.face + 'w';
  }
  return body + suffix;
}

export function movesToString(moves: readonly Move[]): string {
  return moves.map(moveToString).join(' ');
}

const MOVE_RE = /^(?:(\d)(?:-(\d))?)?([URFDLB])(w)?(2|')?$/;

export function parseMove(text: string): Move {
  const t = MOVE_RE.exec(text.trim());
  if (!t) throw new Error('cannot parse move "' + text + '"');
  const face = t[3] as string;
  const wide = !!t[4];
  let from = 1;
  let to = 1;
  if (t[1] && t[2]) {
    from = Number(t[1]);
    to = Number(t[2]);
    if (!wide) throw new Error('a layer range needs w: "' + text + '"');
  } else if (t[1]) {
    if (wide) to = Number(t[1]);
    else from = to = Number(t[1]);
  } else if (wide) {
    to = 2;
  }
  if (from < 1 || to > N || from > to) throw new Error('bad layers in "' + text + '"');
  const clockwise = t[5] === '2' ? 2 : t[5] === "'" ? 3 : 1;
  const pi = POSITIVE_FACE.indexOf(face);
  if (pi >= 0) return { axis: pi as Axis, lo: N - to, hi: N - from, q: clockwise };
  const ni = NEGATIVE_FACE.indexOf(face);
  return { axis: ni as Axis, lo: from - 1, hi: to - 1, q: (4 - clockwise) & 3 };
}

export function parseMoves(text: string): Move[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map(parseMove);
}

/** Every block that lies in one half of the cube, with every turn amount: 108 moves. */
export function allHalfBlockMoves(): Move[] {
  const out: Move[] = [];
  for (let axis = 0 as Axis; axis < 3; axis++) {
    for (const [a, b] of [
      [0, N / 2 - 1],
      [N / 2, N - 1],
    ] as const) {
      for (let lo = a; lo <= b; lo++) for (let hi = lo; hi <= b; hi++) for (let q = 1; q <= 3; q++) out.push({ axis, lo, hi, q });
    }
  }
  return out;
}

/** A scramble of random single-layer and block turns. `rand` returns a float in [0, 1). */
export function randomMoves(count: number, rand: () => number): Move[] {
  const all = allHalfBlockMoves();
  const out: Move[] = [];
  let lastAxis = -1;
  while (out.length < count) {
    const m = all[Math.floor(rand() * all.length)] as Move;
    if (m.axis === lastAxis) continue;
    lastAxis = m.axis;
    out.push(m);
  }
  return out;
}

/** Small deterministic PRNG (mulberry32) so tests and reports are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
