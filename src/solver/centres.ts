/**
 * Mask machinery for centre pieces, and the solver for the last two centres.
 *
 * The first four centres are solved bar by bar from lookup tables (bars.ts). The last two (B and L in
 * the solver's frame) are solved in one go by IDA*: the state is, per orbit, which of the eight B/L
 * positions hold the B colour (70 possibilities), the generators are B and L turns plus the classic
 * three-move exchange  slice, turn, slice back  restricted so that F and R survive, and the heuristic
 * is the exact distance of every pair of orbits (six tables of 4900 entries).
 */
import { N, U, R, F, D, L, B } from '../cube/geometry';
import { CENTRES } from '../cube/pieces';
import { movePerm, type Move, type Axis } from '../cube/moves';

export const ORBITS = 4;
export const ORBIT_SIZE = 24;

/** ORBIT_FACELETS[orbit][face * 4 + k] = facelet index. */
export const ORBIT_FACELETS: number[][] = [[], [], [], []];
/** Row and column (1..4) of each orbit position. */
export const ORBIT_ROW: number[][] = [[], [], [], []];
export const ORBIT_COL: number[][] = [[], [], [], []];
const POS_OF_FACELET = new Int16Array(216).fill(-1);
for (const c of CENTRES) {
  const list = ORBIT_FACELETS[c.orbit] as number[];
  POS_OF_FACELET[c.facelet] = list.length;
  list.push(c.facelet);
  (ORBIT_ROW[c.orbit] as number[]).push(c.row);
  (ORBIT_COL[c.orbit] as number[]).push(c.col);
}
for (let o = 0; o < ORBITS; o++) {
  for (let i = 0; i < ORBIT_SIZE; i++) {
    const f = (ORBIT_FACELETS[o] as number[])[i] as number;
    if (Math.floor(f / 36) !== Math.floor(i / 4)) throw new Error('centre orbit layout');
  }
}

/** Colour masks of the centre pieces: masks[orbit * 6 + colour] has bit p set when position p shows that colour. */
export function centreMasks(state: ArrayLike<number>): Int32Array {
  const m = new Int32Array(ORBITS * 6);
  for (let o = 0; o < ORBITS; o++) {
    const fl = ORBIT_FACELETS[o] as number[];
    for (let p = 0; p < ORBIT_SIZE; p++) {
      const idx = o * 6 + (state[fl[p] as number] as number);
      m[idx] = (m[idx] as number) | (1 << p);
    }
  }
  return m;
}

function orbitPermOfMove(m: Move): Uint8Array[] {
  const p = movePerm(m);
  const out: Uint8Array[] = [];
  for (let o = 0; o < ORBITS; o++) {
    const fl = ORBIT_FACELETS[o] as number[];
    const pp = new Uint8Array(ORBIT_SIZE);
    for (let i = 0; i < ORBIT_SIZE; i++) pp[i] = POS_OF_FACELET[p[fl[i] as number] as number] as number;
    out.push(pp);
  }
  return out;
}

const BINOM: number[][] = [];
for (let n = 0; n <= 24; n++) {
  const row = [1];
  for (let k = 1; k <= 4; k++) row.push(n === 0 ? 0 : ((BINOM[n - 1] as number[])[k - 1] as number) + ((BINOM[n - 1] as number[])[k] ?? 0));
  BINOM.push(row);
}
export const MASK_STATES = 10626;
const B1 = new Int32Array(24);
const B2 = new Int32Array(24);
const B3 = new Int32Array(24);
const B4 = new Int32Array(24);
for (let n = 0; n < 24; n++) {
  B1[n] = (BINOM[n] as number[])[1] as number;
  B2[n] = (BINOM[n] as number[])[2] as number;
  B3[n] = (BINOM[n] as number[])[3] as number;
  B4[n] = (BINOM[n] as number[])[4] as number;
}

/** Rank of a 24-bit mask with exactly four bits set, 0..10625. */
export function rank4(mask: number): number {
  const a = 31 - Math.clz32(mask & -mask);
  mask &= mask - 1;
  const b = 31 - Math.clz32(mask & -mask);
  mask &= mask - 1;
  const c = 31 - Math.clz32(mask & -mask);
  mask &= mask - 1;
  const d = 31 - Math.clz32(mask);
  return (B1[a] as number) + (B2[b] as number) + (B3[c] as number) + (B4[d] as number);
}

export interface Gen {
  moves: Move[];
  cost: number;
  /** Mask transform tables: 4 orbits x 3 bytes x 256 entries. */
  t: Int32Array;
  /** Bit 0: flips the parity of quarter turns of the second layers; bit 1: of the third layers. */
  parity: number;
  axis: number;
  /** Used to skip pointless successors: the same slice or face twice in a row. */
  tag: number;
}

function sliceParity(m: Move): number {
  if ((m.q & 1) === 0) return 0;
  let p = 0;
  for (let l = m.lo; l <= m.hi; l++) {
    if (l === 1 || l === N - 2) p ^= 1;
    if (l === 2 || l === N - 3) p ^= 2;
  }
  return p;
}

export function movesParity(moves: readonly Move[]): number {
  let p = 0;
  for (const m of moves) p ^= sliceParity(m);
  return p;
}

export function makeGen(moves: Move[], tag: number): Gen {
  let perms: Uint8Array[] | null = null;
  let parity = 0;
  for (const m of moves) {
    const pm = orbitPermOfMove(m);
    parity ^= sliceParity(m);
    if (!perms) perms = pm;
    else {
      const next: Uint8Array[] = [];
      for (let o = 0; o < ORBITS; o++) {
        const a = perms[o] as Uint8Array;
        const b = pm[o] as Uint8Array;
        const c = new Uint8Array(ORBIT_SIZE);
        for (let i = 0; i < ORBIT_SIZE; i++) c[i] = a[b[i] as number] as number;
        next.push(c);
      }
      perms = next;
    }
  }
  const t = new Int32Array(ORBITS * 3 * 256);
  for (let o = 0; o < ORBITS; o++) {
    const pp = (perms as Uint8Array[])[o] as Uint8Array;
    const dest = new Uint8Array(ORBIT_SIZE);
    for (let i = 0; i < ORBIT_SIZE; i++) dest[pp[i] as number] = i;
    for (let byte = 0; byte < 3; byte++) {
      for (let v = 0; v < 256; v++) {
        let out = 0;
        for (let bit = 0; bit < 8; bit++) if (v & (1 << bit)) out |= 1 << (dest[byte * 8 + bit] as number);
        t[(o * 3 + byte) * 256 + v] = out;
      }
    }
  }
  return { moves, cost: moves.length, t, parity, axis: moves.length === 1 ? (moves[0] as Move).axis : -1, tag };
}

export function applyGen(g: Gen, o: number, mask: number): number {
  const base = o * 768;
  return (g.t[base + (mask & 255)] as number) | (g.t[base + 256 + ((mask >> 8) & 255)] as number) | (g.t[base + 512 + (mask >>> 16)] as number);
}

function faceMove(face: number, q: number): Move {
  const axis = (face === R || face === L ? 0 : face === U || face === D ? 1 : 2) as Axis;
  const layer = face === R || face === U || face === F ? N - 1 : 0;
  return { axis, lo: layer, hi: layer, q };
}

const INNER_BLOCKS: [number, number][] = [
  [1, 1],
  [2, 2],
  [1, 2],
  [4, 4],
  [3, 3],
  [3, 4],
];

interface LastTwo {
  gens: Gen[];
  /** pair[a * 4 + b] for a < b: distance by rank70(a) * 70 + rank70(b). */
  pair: Uint8Array[];
  rank70: Uint8Array;
}

let lastTwoCache: LastTwo | null = null;

function lastTwo(): LastTwo {
  if (lastTwoCache) return lastTwoCache;
  const gens: Gen[] = [];
  let tag = 0;
  for (const f of [B, L]) for (let q = 1; q <= 3; q++) gens.push(makeGen([faceMove(f, q)], f));
  for (const [lo, hi] of INNER_BLOCKS) {
    // y slice q=1 parks L's row on B (F's on L, R's on F): only B may turn. q=3 parks B's row on L: only L may turn.
    for (const [q, face] of [
      [1, B],
      [3, L],
    ] as const) {
      const s: Move = { axis: 1, lo, hi, q };
      for (let k = 1; k <= 3; k++) gens.push(makeGen([s, faceMove(face, k), { axis: 1, lo, hi, q: 4 - q }], 100 + tag));
      tag++;
    }
  }
  const rank70 = new Uint8Array(256).fill(255);
  let n = 0;
  for (let m = 0; m < 256; m++) {
    let pop = 0;
    for (let b = 0; b < 8; b++) if (m & (1 << b)) pop++;
    if (pop === 4) rank70[m] = n++;
  }
  const goal = 15 << 20;
  const pair: Uint8Array[] = new Array(16);
  for (let a = 0; a < ORBITS; a++)
    for (let b = a + 1; b < ORBITS; b++) {
      const dist = new Uint8Array(4900).fill(255);
      const key = (ma: number, mb: number): number => (rank70[ma >>> 16] as number) * 70 + (rank70[mb >>> 16] as number);
      dist[key(goal, goal)] = 0;
      const buckets: [number, number][][] = [[[goal, goal]]];
      for (let d = 0; d < buckets.length; d++) {
        for (const [ma, mb] of buckets[d] as [number, number][]) {
          if (dist[key(ma, mb)] !== d) continue;
          for (const g of gens) {
            const na = applyGen(g, a, ma);
            const nb = applyGen(g, b, mb);
            const k = key(na, nb);
            const nd = d + g.cost;
            if (nd < (dist[k] as number)) {
              dist[k] = nd;
              while (buckets.length <= nd) buckets.push([]);
              (buckets[nd] as [number, number][]).push([na, nb]);
            }
          }
        }
      }
      pair[a * 4 + b] = dist;
    }
  lastTwoCache = { gens, pair, rank70 };
  return lastTwoCache;
}

/** Build the last-two-centres tables ahead of time. */
export function prepareLastTwo(): void {
  lastTwo();
}

/**
 * Solve the last two centres. Requires U, D, F and R centres finished; `colour` is the colour that
 * belongs on B. Returns null if the node budget runs out.
 */
export function solveLastTwoCentres(state: ArrayLike<number>, colour: number, maxNodes = 5e6): Move[] | null {
  const { gens, pair, rank70 } = lastTwo();
  const all = centreMasks(state);
  const start = [all[colour] as number, all[6 + colour] as number, all[12 + colour] as number, all[18 + colour] as number];
  for (const m of start) if ((m & 0xffff) !== 0) return null;
  const p01 = pair[1] as Uint8Array;
  const p02 = pair[2] as Uint8Array;
  const p03 = pair[3] as Uint8Array;
  const p12 = pair[6] as Uint8Array;
  const p13 = pair[7] as Uint8Array;
  const p23 = pair[11] as Uint8Array;
  const h = (a: number, b: number, c: number, d: number): number => {
    const ra = (rank70[a >>> 16] as number) * 70;
    const rb = rank70[b >>> 16] as number;
    const rc = rank70[c >>> 16] as number;
    const rd = rank70[d >>> 16] as number;
    let v = p01[ra + rb] as number;
    let w = p02[ra + rc] as number;
    if (w > v) v = w;
    w = p03[ra + rd] as number;
    if (w > v) v = w;
    w = p12[rb * 70 + rc] as number;
    if (w > v) v = w;
    w = p13[rb * 70 + rd] as number;
    if (w > v) v = w;
    w = p23[rc * 70 + rd] as number;
    if (w > v) v = w;
    return v;
  };
  const path: number[] = [];
  let nodes = 0;
  let aborted = false;
  const ng = gens.length;
  const dfs = (a: number, b: number, c: number, d: number, left: number, last: number): boolean => {
    for (let gi = 0; gi < ng; gi++) {
      const g = gens[gi] as Gen;
      if (g.cost > left) continue;
      if (last >= 0 && (gens[last] as Gen).tag === g.tag) continue;
      const na = applyGen(g, 0, a);
      const nb = applyGen(g, 1, b);
      const nc = applyGen(g, 2, c);
      const nd = applyGen(g, 3, d);
      const rest = left - g.cost;
      const hv = h(na, nb, nc, nd);
      if (hv > rest) continue;
      if (++nodes > maxNodes) {
        aborted = true;
        return false;
      }
      path.push(gi);
      if (hv === 0) return true;
      if (dfs(na, nb, nc, nd, rest, gi)) return true;
      path.pop();
      if (aborted) return false;
    }
    return false;
  };
  const h0 = h(start[0] as number, start[1] as number, start[2] as number, start[3] as number);
  if (h0 === 255) return null;
  if (h0 === 0) return [];
  for (let bound = h0; bound <= 60; bound++) {
    if (dfs(start[0] as number, start[1] as number, start[2] as number, start[3] as number, bound, -1)) {
      const moves: Move[] = [];
      for (const gi of path) for (const m of (gens[gi] as Gen).moves) moves.push(m);
      return moves;
    }
    if (aborted) return null;
  }
  return null;
}
