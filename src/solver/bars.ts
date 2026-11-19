/**
 * Bar tables for the centre solver.
 *
 * The centres are solved face by face, and each face in four bars (a column or row of its 4x4 block).
 * A bar needs four pieces: two X centres and one oblique of each hand. For every bar there is a small
 * set of generators that cannot disturb anything solved earlier (the finished faces and the other
 * bars of the current face stay exactly where they are), and a breadth-first table over the positions
 * of four chosen pieces under those generators. Solving a bar is then a table lookup: try every way of
 * choosing four pieces of the right colour, take the cheapest, and walk the table down to zero.
 * There is no search at solve time, so a whole centre solution costs microseconds and many different
 * orders of attack can be compared.
 *
 * Frame: the tables are for the order U, D, F, R, B (L then falls out). Other orders come from
 * rotating the cube first.
 */
import { N, U, R, F, D, L, B } from '../cube/geometry';
import { CENTRES } from '../cube/pieces';
import { movePerm, type Move, type Axis } from '../cube/moves';

export const ORBITS = 4;
export const ORBIT_SIZE = 24;

/** ORBIT_FACELETS[orbit][face * 4 + k] = facelet index. */
export const ORBIT_FACELETS: number[][] = [[], [], [], []];
const ORBIT_ROW: number[][] = [[], [], [], []];
const ORBIT_COL: number[][] = [[], [], [], []];
const POS_OF_FACELET = new Int16Array(216).fill(-1);
for (const c of CENTRES) {
  const list = ORBIT_FACELETS[c.orbit] as number[];
  POS_OF_FACELET[c.facelet] = list.length;
  list.push(c.facelet);
  (ORBIT_ROW[c.orbit] as number[]).push(c.row);
  (ORBIT_COL[c.orbit] as number[]).push(c.col);
}

export interface BarGen {
  moves: Move[];
  cost: number;
  /** Bit 0: odd number of quarter turns of second layers; bit 1: of third layers. */
  parity: number;
  /** dest[orbit * 24 + position] = position after the generator. */
  dest: Uint8Array;
}

export function sliceParity(m: Move): number {
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

const destCache = new Map<number, Uint8Array>();
function moveDest(m: Move): Uint8Array {
  const key = ((m.axis * 6 + m.lo) * 6 + m.hi) * 4 + m.q;
  let d = destCache.get(key);
  if (d) return d;
  const p = movePerm(m);
  d = new Uint8Array(ORBITS * ORBIT_SIZE);
  for (let o = 0; o < ORBITS; o++) {
    const fl = ORBIT_FACELETS[o] as number[];
    // pull form: after[i] = before[p[i]], so the piece at position j = pos(p[fl[i]]) goes to i.
    for (let i = 0; i < ORBIT_SIZE; i++) d[o * ORBIT_SIZE + (POS_OF_FACELET[p[fl[i] as number] as number] as number)] = i;
  }
  destCache.set(key, d);
  return d;
}

function makeGen(moves: Move[]): BarGen {
  let dest: Uint8Array | null = null;
  let parity = 0;
  for (const m of moves) {
    const d = moveDest(m);
    parity ^= sliceParity(m);
    if (!dest) dest = d.slice();
    else for (let i = 0; i < dest.length; i++) dest[i] = d[Math.floor(i / ORBIT_SIZE) * ORBIT_SIZE + (dest[i] as number)] as number;
  }
  return { moves, cost: moves.length, parity, dest: dest as Uint8Array };
}

export interface Slot {
  orbit: number;
  target: number;
}

export interface BarTable {
  stage: number;
  /** 1..4: the column (stages 1, 2) or row (stages 3 to 5). */
  bar: number;
  slots: Slot[];
  gens: BarGen[];
  parityStates: number;
  dist: Uint8Array;
}

const P1 = ORBIT_SIZE;
const P2 = ORBIT_SIZE * ORBIT_SIZE;
const P3 = P2 * ORBIT_SIZE;
const TUPLES = P3 * ORBIT_SIZE;

function buildTable(stage: number, bar: number, slots: Slot[], gens: BarGen[], parityStates: number): BarTable {
  const dist = new Uint8Array(TUPLES * parityStates).fill(255);
  const o0 = (slots[0] as Slot).orbit * ORBIT_SIZE;
  const o1 = (slots[1] as Slot).orbit * ORBIT_SIZE;
  const o2 = (slots[2] as Slot).orbit * ORBIT_SIZE;
  const o3 = (slots[3] as Slot).orbit * ORBIT_SIZE;
  const start = ((slots[0] as Slot).target + (slots[1] as Slot).target * P1 + (slots[2] as Slot).target * P2 + (slots[3] as Slot).target * P3) * parityStates;
  dist[start] = 0;
  const buckets: number[][] = [[start]];
  const pmask = parityStates - 1;
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d] as number[];
    for (let bi = 0; bi < bucket.length; bi++) {
      const s = bucket[bi] as number;
      if (dist[s] !== d) continue;
      const par = parityStates === 1 ? 0 : s & 3;
      let t = parityStates === 1 ? s : s >> 2;
      const a = t % ORBIT_SIZE;
      t = (t - a) / ORBIT_SIZE;
      const b = t % ORBIT_SIZE;
      t = (t - b) / ORBIT_SIZE;
      const c = t % ORBIT_SIZE;
      const e = (t - c) / ORBIT_SIZE;
      for (let gi = 0; gi < gens.length; gi++) {
        const g = gens[gi] as BarGen;
        const dd = g.dest;
        const ns = ((dd[o0 + a] as number) + (dd[o1 + b] as number) * P1 + (dd[o2 + c] as number) * P2 + (dd[o3 + e] as number) * P3) * parityStates + ((par ^ g.parity) & pmask);
        const nd = d + g.cost;
        if (nd < (dist[ns] as number)) {
          dist[ns] = nd;
          while (buckets.length <= nd) buckets.push([]);
          (buckets[nd] as number[]).push(ns);
        }
      }
    }
  }
  return { stage, bar, slots, gens, parityStates, dist };
}

function faceMove(face: number, q: number): Move {
  const axis = (face === R || face === L ? 0 : face === U || face === D ? 1 : 2) as Axis;
  const layer = face === R || face === U || face === F ? N - 1 : 0;
  return { axis, lo: layer, hi: layer, q };
}
function inv(m: Move): Move {
  return { axis: m.axis, lo: m.lo, hi: m.hi, q: 4 - m.q };
}
function turns(faces: number[]): Move[] {
  return faces.flatMap((f) => [1, 2, 3].map((q) => faceMove(f, q)));
}
function layerMoves(axis: Axis, layer: number): Move[] {
  return [1, 2, 3].map((q) => ({ axis, lo: layer, hi: layer, q }));
}
const INNER_BLOCKS: [number, number][] = [
  [1, 1],
  [2, 2],
  [1, 2],
  [4, 4],
  [3, 3],
  [3, 4],
];

function barSlots(face: number, isColumn: boolean, index: number): Slot[] {
  const out: Slot[] = [];
  for (let k = 1; k <= 4; k++) {
    const row = isColumn ? k : index;
    const col = isColumn ? index : k;
    for (let o = 0; o < ORBITS; o++)
      for (let p = face * 4; p < face * 4 + 4; p++)
        if ((ORBIT_ROW[o] as number[])[p] === row && (ORBIT_COL[o] as number[])[p] === col) out.push({ orbit: o, target: p });
  }
  if (out.length !== 4) throw new Error('bar slots');
  return out;
}

/** On a y slice of q quarter turns, the row that was on F ends up on this face. */
const F_ROW_GOES_TO = [-1, L, B, R];
const R_ROW_GOES_TO = [-1, F, L, B];

function stageGens(stage: number, bar: number): BarGen[] {
  const plain = (moves: Move[]): BarGen[] => moves.map((m) => makeGen([m]));
  const yBlocks: Move[] = [];
  for (const [lo, hi] of INNER_BLOCKS) for (let q = 1; q <= 3; q++) yBlocks.push({ axis: 1, lo, hi, q });
  const macro = (s: Move, face: number): BarGen[] => [1, 2, 3].map((k) => makeGen([s, faceMove(face, k), inv(s)]));
  if (stage === 1) {
    // Column `bar` of U. Everything except the other three U columns may move.
    return plain([...yBlocks, ...turns([D, F, R, B, L]), ...layerMoves(0, bar)]);
  }
  if (stage === 2) {
    // Column `bar` of D with U finished: build the bar on the belt, then  slice, side turn, slice back.
    const gens = plain([...yBlocks, ...turns([F, R, B, L])]);
    gens.push(...macro({ axis: 0, lo: bar, hi: bar, q: 1 }, F));
    gens.push(...macro({ axis: 0, lo: bar, hi: bar, q: 3 }, B));
    return gens;
  }
  const layer = N - 1 - bar;
  if (stage === 3) {
    // Row `bar` of F with U and D finished.
    const gens = plain([...layerMoves(1, layer), ...turns([R, B, L])]);
    for (let l = 1; l <= 4; l++) {
      if (l === layer) continue;
      for (let q = 1; q <= 3; q++) for (const y of [R, B, L]) if (y !== F_ROW_GOES_TO[q]) gens.push(...macro({ axis: 1, lo: l, hi: l, q }, y));
    }
    return gens;
  }
  if (stage === 4) {
    // Row `bar` of R with U, D, F finished.
    const gens = plain(turns([B, L]));
    for (let q = 1; q <= 3; q++) for (const y of [B, L]) if (y !== F_ROW_GOES_TO[q]) gens.push(...macro({ axis: 1, lo: layer, hi: layer, q }, y));
    for (let l = 1; l <= 4; l++) {
      if (l === layer) continue;
      for (let q = 1; q <= 3; q++) for (const y of [B, L]) if (y !== F_ROW_GOES_TO[q] && y !== R_ROW_GOES_TO[q]) gens.push(...macro({ axis: 1, lo: l, hi: l, q }, y));
    }
    return gens;
  }
  // Stage 5: row `bar` of B with U, D, F, R finished.
  const gens = plain(turns([L]));
  gens.push(...macro({ axis: 1, lo: layer, hi: layer, q: 3 }, L));
  return gens;
}

const STAGE_FACE = [-1, U, D, F, R, B];

let tablesCache: BarTable[][] | null = null;

/** tables[stage][bar], stage 1..5, bar 1..4. */
export function barTables(): BarTable[][] {
  if (tablesCache) return tablesCache;
  const out: BarTable[][] = [[]];
  for (let stage = 1; stage <= 5; stage++) {
    const row: BarTable[] = [undefined as unknown as BarTable];
    for (let bar = 1; bar <= 4; bar++) {
      row.push(buildTable(stage, bar, barSlots(STAGE_FACE[stage] as number, stage <= 2, bar), stageGens(stage, bar), stage === 3 ? 4 : 1));
    }
    out.push(row);
  }
  tablesCache = out;
  return out;
}

export interface BarSolution {
  cost: number;
  moves: Move[];
  parity: number;
}

const scratchPos: number[][] = [[], [], [], []];

/**
 * Cheapest way to fill one bar with pieces of `colour`. `state` is the full facelet array.
 * wantParity: -1 for "any", otherwise the solution's slice parity must equal it (stage 3 tables only).
 */
export function solveBarByTable(table: BarTable, state: ArrayLike<number>, colour: number, wantParity: number): BarSolution | null {
  const slots = table.slots;
  for (let o = 0; o < ORBITS; o++) {
    const list = scratchPos[o] as number[];
    list.length = 0;
    const fl = ORBIT_FACELETS[o] as number[];
    for (let p = 0; p < ORBIT_SIZE; p++) if (state[fl[p] as number] === colour) list.push(p);
  }
  const c0 = scratchPos[(slots[0] as Slot).orbit] as number[];
  const c1 = scratchPos[(slots[1] as Slot).orbit] as number[];
  const c2 = scratchPos[(slots[2] as Slot).orbit] as number[];
  const c3 = scratchPos[(slots[3] as Slot).orbit] as number[];
  const same01 = (slots[0] as Slot).orbit === (slots[1] as Slot).orbit;
  const same02 = (slots[0] as Slot).orbit === (slots[2] as Slot).orbit;
  const same03 = (slots[0] as Slot).orbit === (slots[3] as Slot).orbit;
  const same12 = (slots[1] as Slot).orbit === (slots[2] as Slot).orbit;
  const same13 = (slots[1] as Slot).orbit === (slots[3] as Slot).orbit;
  const same23 = (slots[2] as Slot).orbit === (slots[3] as Slot).orbit;
  const dist = table.dist;
  const ps = table.parityStates;
  let best = 255;
  let bestIndex = -1;
  for (const a of c0)
    for (const b of c1) {
      if (same01 && a === b) continue;
      for (const c of c2) {
        if ((same02 && a === c) || (same12 && b === c)) continue;
        for (const e of c3) {
          if ((same03 && a === e) || (same13 && b === e) || (same23 && c === e)) continue;
          const t = (a + b * P1 + c * P2 + e * P3) * ps;
          if (ps === 1) {
            const v = dist[t] as number;
            if (v < best) {
              best = v;
              bestIndex = t;
            }
          } else if (wantParity >= 0) {
            const v = dist[t + wantParity] as number;
            if (v < best) {
              best = v;
              bestIndex = t + wantParity;
            }
          } else {
            for (let p = 0; p < 4; p++) {
              const v = dist[t + p] as number;
              if (v < best) {
                best = v;
                bestIndex = t + p;
              }
            }
          }
        }
      }
    }
  if (bestIndex < 0 || best === 255) return null;
  // Walk the table down to the goal.
  const moves: Move[] = [];
  let parity = 0;
  let s = bestIndex;
  let d = best;
  const o0 = (slots[0] as Slot).orbit * ORBIT_SIZE;
  const o1 = (slots[1] as Slot).orbit * ORBIT_SIZE;
  const o2 = (slots[2] as Slot).orbit * ORBIT_SIZE;
  const o3 = (slots[3] as Slot).orbit * ORBIT_SIZE;
  const gens = table.gens;
  while (d > 0) {
    const par = ps === 1 ? 0 : s & 3;
    let t = ps === 1 ? s : s >> 2;
    const a = t % ORBIT_SIZE;
    t = (t - a) / ORBIT_SIZE;
    const b = t % ORBIT_SIZE;
    t = (t - b) / ORBIT_SIZE;
    const c = t % ORBIT_SIZE;
    const e = (t - c) / ORBIT_SIZE;
    let stepped = false;
    for (let gi = 0; gi < gens.length; gi++) {
      const g = gens[gi] as BarGen;
      if (g.cost > d) continue;
      const dd = g.dest;
      const ns = ((dd[o0 + a] as number) + (dd[o1 + b] as number) * P1 + (dd[o2 + c] as number) * P2 + (dd[o3 + e] as number) * P3) * ps + ((par ^ g.parity) & (ps - 1));
      if ((dist[ns] as number) === d - g.cost) {
        for (const m of g.moves) moves.push(m);
        parity ^= g.parity;
        s = ns;
        d -= g.cost;
        stepped = true;
        break;
      }
    }
    if (!stepped) throw new Error('bar table walk failed');
  }
  return { cost: best, moves, parity };
}
