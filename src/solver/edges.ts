/**
 * Edge pairing: with the centres solved, bring the 48 edge wings together into twelve groups of four.
 *
 * Method: free-slice pairing, searched by a beam.
 *
 * Fix an axis. The four edges parallel to it form the "belt"; each inner layer across the axis carries
 * one wing of each belt edge. Turning inner layers ("slicing") shifts wings between belt edges but also
 * shears the side centres, so slices must be undone eventually. In between, short outer-turn triggers
 * such as R U R' swap a belt edge with an edge of the top or bottom layer without touching centres.
 *
 * The search works in the "closed view": the wing arrangement C you would get by undoing the current
 * slice offsets. Slicing does not change C. A trigger X performed while the layers are offset by v acts
 * on C as the macro  slice(v) X slice(v)^-1 , which cycles wings three at a time between two belt edges
 * and the edge X brings in, independently per layer. So one node is (C, axis, offsets) and one step is
 * "re-slice to v, do X", costing only the slices that differ from the previous offsets plus X. Because
 * each wing's fate under the macro depends on the offset of one layer only, the best v for a given X is
 * found exactly from small per-layer tables instead of trying every combination on the full state.
 *
 * Progress is measured in bonds: adjacent wings of one edge that already match (36 when all paired).
 */
import { N, NN } from '../cube/geometry';
import { WINGS } from '../cube/pieces';
import { movePerm, type Move, type Axis } from '../cube/moves';

const NS = 48;
const BONDS = 36;
const SLOT_CODE = new Int16Array(216).fill(-1);
WINGS.forEach((w, i) => {
  SLOT_CODE[w.facelets[0]] = i * 2;
  SLOT_CODE[w.facelets[1]] = i * 2 + 1;
});
const SWAP_VALUE = new Uint8Array(36);
for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) SWAP_VALUE[a * 6 + b] = b * 6 + a;

/** Wing values of a state: per slot, colour on the edge's first face * 6 + colour on its second face. */
export function wingValues(state: ArrayLike<number>): Uint8Array {
  const v = new Uint8Array(NS);
  for (let i = 0; i < NS; i++) {
    const w = WINGS[i] as (typeof WINGS)[number];
    v[i] = (state[w.facelets[0]] as number) * 6 + (state[w.facelets[1]] as number);
  }
  return v;
}

export function countBonds(c: Uint8Array): number {
  let n = 0;
  for (let e = 0; e < NS; e += 4) {
    if (c[e] === c[e + 1]) n++;
    if (c[e + 1] === c[e + 2]) n++;
    if (c[e + 2] === c[e + 3]) n++;
  }
  return n;
}

export function edgesPaired(state: ArrayLike<number>): boolean {
  return countBonds(wingValues(state)) === BONDS;
}

/** next[i] = swap[i] ? swapped(prev[src[i]]) : prev[src[i]] */
interface SlotPerm {
  src: Uint8Array;
  swap: Uint8Array;
}

function slotPermOfMove(m: Move): SlotPerm {
  const p = movePerm(m);
  const src = new Uint8Array(NS);
  const swap = new Uint8Array(NS);
  for (let i = 0; i < NS; i++) {
    const code = SLOT_CODE[p[(WINGS[i] as (typeof WINGS)[number]).facelets[0]] as number] as number;
    src[i] = code >> 1;
    swap[i] = code & 1;
  }
  return { src, swap };
}

const IDENTITY: SlotPerm = { src: Uint8Array.from({ length: NS }, (_, i) => i), swap: new Uint8Array(NS) };

/** a first, then b. */
function compose(a: SlotPerm, b: SlotPerm): SlotPerm {
  const src = new Uint8Array(NS);
  const swap = new Uint8Array(NS);
  for (let i = 0; i < NS; i++) {
    const j = b.src[i] as number;
    src[i] = a.src[j] as number;
    swap[i] = (b.swap[i] as number) ^ (a.swap[j] as number);
  }
  return { src, swap };
}

function permOfMoves(moves: readonly Move[]): SlotPerm {
  let p = IDENTITY;
  for (const m of moves) p = compose(p, slotPermOfMove(m));
  return p;
}

function applySlotPerm(c: Uint8Array, p: SlotPerm): Uint8Array {
  const out = new Uint8Array(NS);
  for (let i = 0; i < NS; i++) {
    const v = c[p.src[i] as number] as number;
    out[i] = p.swap[i] ? (SWAP_VALUE[v] as number) : v;
  }
  return out;
}

interface Trigger {
  moves: Move[];
  perm: SlotPerm;
  /** layer (1..4) whose offset decides where slot i's wing comes from, 0 when no layer does. */
  gov: Uint8Array;
  /** src/swap by offset value: tabSrc[v * 48 + i]. */
  tabSrc: Uint8Array;
  tabSwap: Uint8Array;
  /** Bonds grouped by which layers govern them. */
  staticBonds: number[];
  unaryBonds: number[][];
  pairKeys: number[];
  pairBonds: number[][];
}

/** An in-place flip of one belt edge (seven outer turns that leave the side centres as they were). */
interface Flip {
  moves: Move[];
  /** Composite slice(v) X slice(v)^-1 for every offset vector: src[vec * 48 + i]. */
  src: Uint8Array;
  swap: Uint8Array;
}

interface AxisData {
  axis: Axis;
  triggers: Trigger[];
  flips: Flip[];
  /** Rigid quarter turns of the four inner layers together: shift[u]. */
  shift: SlotPerm[];
  faceTurns: { move: Move; perm: SlotPerm }[];
}

function faceMoveOn(axis: Axis, positive: boolean, q: number): Move {
  const layer = positive ? N - 1 : 0;
  return { axis, lo: layer, hi: layer, q };
}

function buildAxis(axis: Axis): AxisData {
  const others = [0, 1, 2].filter((a) => a !== axis) as Axis[];
  const layerPerm: SlotPerm[][] = [];
  for (let k = 0; k <= 4; k++) {
    const row: SlotPerm[] = [IDENTITY];
    if (k > 0) for (let v = 1; v <= 3; v++) row.push(slotPermOfMove({ axis, lo: k, hi: k, q: v }));
    layerPerm.push(row);
  }
  const triggers: Trigger[] = [];
  for (const sideAxis of others)
    for (const sidePositive of [true, false])
      for (const i of [1, 3])
        for (const capPositive of [true, false])
          for (let k = 1; k <= 3; k++) {
            const a = faceMoveOn(sideAxis, sidePositive, i);
            const moves = [a, faceMoveOn(axis, capPositive, k), faceMoveOn(sideAxis, sidePositive, 4 - i)];
            const perm = permOfMoves(moves);
            const gov = new Uint8Array(NS);
            const tabSrc = new Uint8Array(4 * NS);
            const tabSwap = new Uint8Array(4 * NS);
            for (let v = 0; v < 4; v++) {
              tabSrc.set(perm.src, v * NS);
              tabSwap.set(perm.swap, v * NS);
            }
            for (let layer = 1; layer <= 4; layer++) {
              for (let v = 1; v <= 3; v++) {
                const m = compose(compose((layerPerm[layer] as SlotPerm[])[v] as SlotPerm, perm), (layerPerm[layer] as SlotPerm[])[4 - v] as SlotPerm);
                for (let s = 0; s < NS; s++) {
                  if (m.src[s] !== perm.src[s] || m.swap[s] !== perm.swap[s]) {
                    if (gov[s] !== 0 && gov[s] !== layer) throw new Error('wing governed by two layers');
                    gov[s] = layer;
                  }
                }
              }
            }
            for (let layer = 1; layer <= 4; layer++) {
              for (let v = 1; v <= 3; v++) {
                const m = compose(compose((layerPerm[layer] as SlotPerm[])[v] as SlotPerm, perm), (layerPerm[layer] as SlotPerm[])[4 - v] as SlotPerm);
                for (let s = 0; s < NS; s++)
                  if (gov[s] === layer) {
                    tabSrc[v * NS + s] = m.src[s] as number;
                    tabSwap[v * NS + s] = m.swap[s] as number;
                  }
              }
            }
            const staticBonds: number[] = [];
            const unaryBonds: number[][] = [[], [], [], [], []];
            const pairKeys: number[] = [];
            const pairBonds: number[][] = [];
            for (let e = 0; e < NS; e += 4)
              for (let b = 0; b < 3; b++) {
                const s1 = e + b;
                const s2 = e + b + 1;
                const k1 = gov[s1] as number;
                const k2 = gov[s2] as number;
                if (k1 === 0 && k2 === 0) staticBonds.push(s1);
                else if (k1 === 0 || k2 === 0 || k1 === k2) (unaryBonds[k1 || k2] as number[]).push(s1);
                else {
                  const key = Math.min(k1, k2) * 8 + Math.max(k1, k2);
                  let idx = pairKeys.indexOf(key);
                  if (idx < 0) {
                    idx = pairKeys.length;
                    pairKeys.push(key);
                    pairBonds.push([]);
                  }
                  (pairBonds[idx] as number[]).push(s1);
                }
              }
            triggers.push({ moves, perm, gov, tabSrc, tabSwap, staticBonds, unaryBonds, pairKeys, pairBonds });
          }
  const shift: SlotPerm[] = [IDENTITY];
  for (let u = 1; u <= 3; u++) shift.push(slotPermOfMove({ axis, lo: 1, hi: 4, q: u }));
  // Flips: A B A' C A' C' A with A, C adjacent side faces and B a cap face (R U R' F R' F' R and its relatives).
  const belt: number[] = [];
  for (let s = 0; s < NS; s++) if ((slotPermOfMove({ axis, lo: 1, hi: 4, q: 1 }).src[s] as number) !== s) belt.push(s);
  const flips: Flip[] = [];
  const seenFlip = new Set<string>();
  const sides: [Axis, boolean][] = [];
  for (const sa of others) for (const pos of [true, false]) sides.push([sa, pos]);
  for (const [aAxis, aPos] of sides)
    for (const [cAxis, cPos] of sides) {
      if (aAxis === cAxis) continue;
      for (const i of [1, 3])
        for (const j of [1, 3])
          for (const capPositive of [true, false])
            for (let k = 1; k <= 3; k++) {
              const A = faceMoveOn(aAxis, aPos, i);
              const Ai = faceMoveOn(aAxis, aPos, 4 - i);
              const C = faceMoveOn(cAxis, cPos, j);
              const Ci = faceMoveOn(cAxis, cPos, 4 - j);
              const moves = [A, faceMoveOn(axis, capPositive, k), Ai, C, Ai, Ci, A];
              const perm = permOfMoves(moves);
              let flipped = 0;
              let ok = true;
              for (const s of belt) {
                const e = s - (s % 4);
                if (perm.src[s] === s && perm.swap[s] === 0) continue;
                if (perm.src[s] === e + 3 - (s % 4) && perm.swap[s] === 1) flipped++;
                else ok = false;
              }
              if (!ok || flipped !== 4) continue;
              const key = Array.from(perm.src).join(',') + '|' + Array.from(perm.swap).join('');
              if (seenFlip.has(key)) continue;
              seenFlip.add(key);
              const fsrc = new Uint8Array(256 * NS);
              const fswap = new Uint8Array(256 * NS);
              for (let vec = 0; vec < 256; vec++) {
                let pre = IDENTITY;
                let post = IDENTITY;
                for (let layer = 1; layer <= 4; layer++) {
                  const v = (vec >> (2 * (layer - 1))) & 3;
                  if (v === 0) continue;
                  pre = compose(pre, (layerPerm[layer] as SlotPerm[])[v] as SlotPerm);
                  post = compose(post, (layerPerm[layer] as SlotPerm[])[4 - v] as SlotPerm);
                }
                const m = compose(compose(pre, perm), post);
                fsrc.set(m.src, vec * NS);
                fswap.set(m.swap, vec * NS);
              }
              flips.push({ moves, src: fsrc, swap: fswap });
            }
    }
  const faceTurns: { move: Move; perm: SlotPerm }[] = [];
  for (const a of [0, 1, 2] as Axis[]) for (const pos of [true, false]) for (let q = 1; q <= 3; q++) {
    const move = faceMoveOn(a, pos, q);
    faceTurns.push({ move, perm: slotPermOfMove(move) });
  }
  return { axis, triggers, flips, shift, faceTurns };
}

let axisCache: AxisData[] | null = null;
function axes(): AxisData[] {
  if (!axisCache) axisCache = [buildAxis(0), buildAxis(1), buildAxis(2)];
  return axisCache;
}

export function prepareEdges(): void {
  axes();
}

function halfCost(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  if (a === 0 || b === 0 || a === b) return 1;
  return 2;
}

/** Block turns needed to change the four inner-layer offsets from o to v (both packed base 4). */
const SLICE_COST = new Uint8Array(256 * 256);
for (let o = 0; o < 256; o++)
  for (let v = 0; v < 256; v++) {
    const d1 = ((v & 3) - (o & 3)) & 3;
    const d2 = (((v >> 2) & 3) - ((o >> 2) & 3)) & 3;
    const d3 = (((v >> 4) & 3) - ((o >> 4) & 3)) & 3;
    const d4 = (((v >> 6) & 3) - ((o >> 6) & 3)) & 3;
    SLICE_COST[o * 256 + v] = halfCost(d1, d2) + halfCost(d3, d4);
  }
const UNIFORM = [0, 0x55, 0xaa, 0xff];
const CLOSE_COST = new Uint8Array(256);
const CLOSE_TO = new Uint8Array(256);
for (let o = 0; o < 256; o++) {
  let best = 9;
  for (let u = 0; u < 4; u++) {
    const c = SLICE_COST[o * 256 + (UNIFORM[u] as number)] as number;
    if (c < best) {
      best = c;
      CLOSE_TO[o] = u;
    }
  }
  CLOSE_COST[o] = best;
}

function sliceMoves(axis: Axis, from: number, to: number): Move[] {
  const out: Move[] = [];
  const d = [0, 1, 2, 3].map((k) => (((to >> (2 * k)) & 3) - ((from >> (2 * k)) & 3)) & 3);
  for (const [a, b, la, lb] of [
    [d[0], d[1], 1, 2],
    [d[2], d[3], 3, 4],
  ] as [number, number, number, number][]) {
    if (a !== 0 && a === b) out.push({ axis, lo: la, hi: lb, q: a });
    else {
      if (a !== 0) out.push({ axis, lo: la, hi: la, q: a });
      if (b !== 0) out.push({ axis, lo: lb, hi: lb, q: b });
    }
  }
  return out;
}

interface Node {
  c: Uint8Array;
  /** -1 when no slice is open. */
  axis: number;
  offsets: number;
  cost: number;
  bonds: number;
  parent: Node | null;
  /** Moves that lead from the parent's physical state to this node's. */
  moves: Move[];
  tie: number;
}

export interface EdgeOptions {
  width?: number;
  /** Maximum number of moves to consider before giving up. */
  maxCost?: number;
  seed?: number;
}

export interface EdgeResult {
  moves: Move[];
  expanded: number;
}

const vals = new Uint8Array(4 * NS);
const unary = new Int32Array(5 * 4);
const p12 = new Int32Array(16);
const p23 = new Int32Array(16);
const p34 = new Int32Array(16);
const lower = new Int32Array(16);
const upper = new Int32Array(16);
const costLo = new Uint8Array(16);
const costHi = new Uint8Array(16);
const scoreByCost = new Int32Array(5);
const vecByCost = new Int32Array(5);

function pairEdgesOnce(state: ArrayLike<number>, width: number, maxCost: number, seedIn: number): EdgeResult | null {
  let seed = seedIn >>> 0;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const data = axes();
  const c0 = wingValues(state);
  const root: Node = { c: c0, axis: -1, offsets: 0, cost: 0, bonds: countBonds(c0), parent: null, moves: [], tie: 0 };
  const buckets: Node[][] = [];
  const hist: Uint16Array[] = [];
  for (let i = 0; i <= maxCost + 12; i++) {
    buckets.push([]);
    hist.push(new Uint16Array(BONDS + 2));
  }
  (buckets[0] as Node[]).push(root);
  let best: Node | null = null;
  let bestTotal = Infinity;
  let expanded = 0;

  /** Could a node with this cost and bond count still make the cut in its bucket? */
  const admissible = (cost: number, bonds: number, closeCost: number): boolean => {
    if (cost > maxCost || cost + closeCost >= bestTotal) return false;
    const h = hist[cost] as Uint16Array;
    let better = 0;
    for (let b = BONDS; b > bonds; b--) better += h[b] as number;
    return better < width;
  };
  const push = (n: Node): void => {
    if (n.axis >= 0 && CLOSE_COST[n.offsets] === 0) {
      // All four layers are offset by the same amount: the centres are whole again.
      const u = CLOSE_TO[n.offsets] as number;
      if (u !== 0) n.c = applySlotPerm(n.c, (data[n.axis] as AxisData).shift[u] as SlotPerm);
      n.axis = -1;
      n.offsets = 0;
    }
    (buckets[n.cost] as Node[]).push(n);
    (hist[n.cost] as Uint16Array)[n.bonds]!++;
  };

  const expandTriggers = (node: Node, ax: AxisData, offsets: number, slack: number): void => {
    const base = node.c;
    const here = node.bonds;
    for (let i = 0; i < 16; i++) {
      costLo[i] = SLICE_COST[(offsets & 15) * 256 + i] as number;
      costHi[i] = SLICE_COST[(offsets >> 4) * 16 * 256 + i * 16] as number;
    }
    for (const trig of ax.triggers) {
      const ts = trig.tabSrc;
      const tw = trig.tabSwap;
      for (let i = 0; i < 4 * NS; i++) {
        const v = base[ts[i] as number] as number;
        vals[i] = tw[i] ? (SWAP_VALUE[v] as number) : v;
      }
      let fixed = 0;
      for (const s of trig.staticBonds) if (vals[s] === vals[s + 1]) fixed++;
      // Quick bound: even if every other bond matched, could this trigger reach the bar?
      if (fixed + (BONDS - trig.staticBonds.length) <= here - slack) continue;
      unary.fill(0);
      const gov = trig.gov;
      for (let k = 1; k <= 4; k++) {
        for (const s of trig.unaryBonds[k] as number[]) {
          const g1 = gov[s] === k ? NS : 0;
          const g2 = gov[s + 1] === k ? NS : 0;
          for (let v = 0; v < 4; v++) if (vals[v * g1 + s] === vals[v * g2 + s + 1]) unary[k * 4 + v]!++;
        }
      }
      p12.fill(0);
      p23.fill(0);
      p34.fill(0);
      for (let p = 0; p < trig.pairKeys.length; p++) {
        const key = trig.pairKeys[p] as number;
        const lo = key >> 3;
        const tab = lo === 1 ? p12 : lo === 2 ? p23 : p34;
        for (const s of trig.pairBonds[p] as number[]) {
          const firstIsLo = gov[s] === lo;
          for (let a = 0; a < 4; a++)
            for (let b = 0; b < 4; b++) {
              const v1 = firstIsLo ? a : b;
              const v2 = firstIsLo ? b : a;
              if (vals[v1 * NS + s] === vals[v2 * NS + s + 1]) tab[a * 4 + b]!++;
            }
        }
      }
      for (let i = 0; i < 16; i++) {
        const a = i & 3;
        const b = i >> 2;
        lower[i] = (unary[4 + a] as number) + (unary[8 + b] as number) + (p12[a * 4 + b] as number);
        upper[i] = (unary[12 + a] as number) + (unary[16 + b] as number) + (p34[a * 4 + b] as number);
      }
      scoreByCost.fill(-1);
      for (let lo = 0; lo < 16; lo++) {
        const base2 = fixed + (lower[lo] as number);
        const row = (lo >> 2) * 4;
        const cl = costLo[lo] as number;
        for (let up = 0; up < 16; up++) {
          const score = base2 + (upper[up] as number) + (p23[row + (up & 3)] as number);
          const sc = cl + (costHi[up] as number);
          if (score > (scoreByCost[sc] as number)) {
            scoreByCost[sc] = score;
            vecByCost[sc] = lo | (up << 4);
          }
        }
      }
      let bar = here - slack;
      for (let sc = 0; sc <= 4; sc++) {
        const score = scoreByCost[sc] as number;
        if (score <= bar) continue;
        bar = score;
        const vec = vecByCost[sc] as number;
        const cost = node.cost + sc + trig.moves.length;
        if (!admissible(cost, score, CLOSE_COST[vec] as number)) continue;
        const c = new Uint8Array(NS);
        for (let s = 0; s < NS; s++) {
          const k = gov[s] as number;
          c[s] = vals[(k === 0 ? 0 : (vec >> (2 * (k - 1))) & 3) * NS + s] as number;
        }
        const moves = sliceMoves(ax.axis, offsets, vec);
        for (const m of trig.moves) moves.push(m);
        push({ c, axis: ax.axis, offsets: vec, cost, bonds: score, parent: node, moves, tie: rnd() });
      }
    }
  };

  const expandFlips = (node: Node, ax: AxisData, offsets: number): void => {
    const base = node.c;
    for (const flip of ax.flips) {
      scoreByCost.fill(-1);
      for (let vec = 1; vec < 256; vec++) {
        const sc = SLICE_COST[offsets * 256 + vec] as number;
        if (sc > 2) continue;
        const o = vec * NS;
        let score = 0;
        for (let e = 0; e < NS; e += 4) {
          let a = base[flip.src[o + e] as number] as number;
          if (flip.swap[o + e]) a = SWAP_VALUE[a] as number;
          for (let b = 1; b < 4; b++) {
            let x = base[flip.src[o + e + b] as number] as number;
            if (flip.swap[o + e + b]) x = SWAP_VALUE[x] as number;
            if (x === a) score++;
            a = x;
          }
        }
        if (score > (scoreByCost[sc] as number)) {
          scoreByCost[sc] = score;
          vecByCost[sc] = vec;
        }
      }
      let bar = node.bonds;
      for (let sc = 0; sc <= 2; sc++) {
        const score = scoreByCost[sc] as number;
        if (score <= bar) continue;
        bar = score;
        const vec = vecByCost[sc] as number;
        const cost = node.cost + sc + flip.moves.length;
        if (!admissible(cost, score, CLOSE_COST[vec] as number)) continue;
        const c = new Uint8Array(NS);
        const o = vec * NS;
        for (let s = 0; s < NS; s++) {
          const v = base[flip.src[o + s] as number] as number;
          c[s] = flip.swap[o + s] ? (SWAP_VALUE[v] as number) : v;
        }
        const moves = sliceMoves(ax.axis, offsets, vec);
        for (const m of flip.moves) moves.push(m);
        push({ c, axis: ax.axis, offsets: vec, cost, bonds: score, parent: node, moves, tie: rnd() });
      }
    }
  };

  for (let cost = 0; cost <= maxCost && cost < bestTotal; cost++) {
    let bucket = buckets[cost] as Node[];
    if (bucket.length === 0) continue;
    buckets[cost] = [];
    bucket.sort((a, b) => b.bonds - a.bonds || a.tie - b.tie);
    const seen = new Set<string>();
    let taken = 0;
    for (const node of bucket) {
      if (taken >= width) break;
      const key = String.fromCharCode(...node.c, node.axis + 1, node.offsets);
      if (seen.has(key)) continue;
      seen.add(key);
      taken++;
      const closeCost = node.axis >= 0 ? (CLOSE_COST[node.offsets] as number) : 0;
      if (node.bonds === BONDS) {
        if (node.cost + closeCost < bestTotal) {
          bestTotal = node.cost + closeCost;
          best = node;
        }
        continue;
      }
      expanded++;
      const endgame = node.bonds >= 28;
      const slack = endgame ? 2 : 0;
      if (node.axis >= 0) {
        const ax = data[node.axis] as AxisData;
        expandTriggers(node, ax, node.offsets, slack);
        if (endgame) expandFlips(node, ax, node.offsets);
        // Closing the slices is a step of its own; the closed node may then open any axis.
        if (admissible(node.cost + closeCost, node.bonds, 0)) {
          const u = CLOSE_TO[node.offsets] as number;
          const c = u === 0 ? node.c : applySlotPerm(node.c, ax.shift[u] as SlotPerm);
          push({ c, axis: -1, offsets: 0, cost: node.cost + closeCost, bonds: node.bonds, parent: node, moves: sliceMoves(node.axis as Axis, node.offsets, UNIFORM[u] as number), tie: rnd() });
        }
      } else {
        for (const ax of data) {
          expandTriggers(node, ax, 0, slack);
          if (endgame) expandFlips(node, ax, 0);
        }
        // Outer turns as set-up moves, once the easy gains are gone.
        if (node.bonds >= 24 && admissible(node.cost + 1, node.bonds, 0)) {
          const parentWasSetup = node.parent !== null && node.moves.length === 1 && node.parent.axis === -1;
          if (!parentWasSetup || node.bonds >= 30)
            for (const ft of (data[0] as AxisData).faceTurns) push({ c: applySlotPerm(node.c, ft.perm), axis: -1, offsets: 0, cost: node.cost + 1, bonds: node.bonds, parent: node, moves: [ft.move], tie: rnd() });
        }
      }
    }
  }
  if (!best) return null;
  const chain: Node[] = [];
  for (let n: Node | null = best; n; n = n.parent) chain.push(n);
  chain.reverse();
  const moves: Move[] = [];
  for (const n of chain) for (const m of n.moves) moves.push(m);
  if (best.axis >= 0) for (const m of sliceMoves(best.axis as Axis, best.offsets, UNIFORM[CLOSE_TO[best.offsets] as number] as number)) moves.push(m);
  return { moves, expanded };
}

/**
 * Pair all edges. `state` must have solved centres and an even wing permutation in both orbits.
 * Widens the beam and retries if a narrow beam does not finish. Returns null only if every attempt fails.
 */
export function pairEdges(state: ArrayLike<number>, options: EdgeOptions = {}): EdgeResult | null {
  const width = options.width ?? 12;
  const maxCost = options.maxCost ?? 130;
  let expanded = 0;
  for (const [w, cost, seed] of [
    [width, maxCost, options.seed ?? 1],
    [width * 4, maxCost + 30, 7],
    [width * 16, maxCost + 60, 13],
    [width * 64, maxCost + 100, 29],
  ] as const) {
    const r = pairEdgesOnce(state, w, cost, seed);
    if (r) return { moves: r.moves, expanded: expanded + r.expanded };
    expanded += 1;
  }
  return null;
}

void NN;
