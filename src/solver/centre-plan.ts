/**
 * Chooses how to attack the centres. Any of the 24 orientations of the solving order (U, D, F, R, then
 * B and L) and any of the 24 ways to put the colour scheme on the faces is a valid plan; plans differ a
 * lot in length, and one plan costs well under a millisecond to evaluate, so many are tried and the
 * shortest is kept.
 *
 * Slice parity. A quarter turn of a second (or third) layer is an odd permutation of the outer (or
 * inner) edge wings. Edge pairing only uses slices in balanced pairs, so the wing parity left by the
 * centre stage is final; if it were odd, the reduced cube would show the well-known "OLL parity".
 * The third centre is the last stage with unbalanced slices, so its final bar is chosen from a table
 * that also tracks slice parity, and the parity problem never appears.
 */
import { U, R, F, D, B, NN } from '../cube/geometry';
import { applyMoves, type Move } from '../cube/moves';
import { ROTATIONS, rotateState, moveToOriginal } from '../cube/rotations';
import type { Scheme } from '../cube/scheme';
import { barTables, solveBarByTable, movesParity, type BarTable } from './bars';
import { solveLastTwoCentres, prepareLastTwo } from './centres';

export interface CentreSolution {
  /** Moves in the original frame. */
  moves: Move[];
  /** Number of moves of each of the five stages. */
  stageLengths: number[];
  /** Plans evaluated. */
  plansTried: number;
}

interface Partial {
  rot: number;
  cu: number;
  state: Uint8Array;
  moves: Move[];
  lengths: number[];
}

function faceDone(state: ArrayLike<number>, face: number, colour: number): boolean {
  for (let r = 1; r <= 4; r++) for (let c = 1; c <= 4; c++) if (state[face * NN + r * 6 + c] !== colour) return false;
  return true;
}

/** Fill the four bars of one face greedily, cheapest bar first. Returns null if a bar cannot be reached. */
function solveFace(tables: BarTable[], state: Uint8Array, colour: number, finalParity: number, parityBefore: number): { state: Uint8Array; moves: Move[] } | null {
  const remaining = [1, 2, 3, 4];
  const moves: Move[] = [];
  let parity = parityBefore;
  let cur = state;
  while (remaining.length) {
    let best: { bar: number; moves: Move[]; cost: number; parity: number } | null = null;
    const last = remaining.length === 1 && finalParity >= 0;
    for (const bar of remaining) {
      const r = solveBarByTable(tables[bar] as BarTable, cur, colour, last ? finalParity ^ parity : -1);
      if (r && (!best || r.cost < best.cost)) best = { bar, moves: r.moves, cost: r.cost, parity: r.parity };
    }
    if (!best) return null;
    if (best.moves.length) cur = applyMoves(cur, best.moves);
    for (const m of best.moves) moves.push(m);
    parity ^= best.parity;
    remaining.splice(remaining.indexOf(best.bar), 1);
  }
  return { state: cur, moves };
}

export function prepareCentres(): void {
  barTables();
  prepareLastTwo();
}

/**
 * Solve all six centres. wantParity: bit 0 set when the outer wings are in an odd permutation, bit 1
 * for the inner wings; the returned moves contain an odd number of second-layer (third-layer) quarter
 * turns exactly when that bit is set.
 */
export function solveCentres(state: Uint8Array, scheme: Scheme, wantParity: number, keep = 10): CentreSolution {
  const tables = barTables();
  const firstTwo: Partial[] = [];
  let plans = 0;
  for (const rot of ROTATIONS) {
    const rotated = rotateState(rot, state);
    for (let cu = 0; cu < 6; cu++) {
      const s1 = solveFace(tables[1] as BarTable[], rotated, cu, -1, 0);
      if (!s1) continue;
      const s2 = solveFace(tables[2] as BarTable[], s1.state, scheme.opposite[cu] as number, -1, 0);
      if (!s2) continue;
      plans++;
      firstTwo.push({ rot: rot.index, cu, state: s2.state, moves: [...s1.moves, ...s2.moves], lengths: [s1.moves.length, s2.moves.length] });
    }
  }
  firstTwo.sort((a, b) => a.moves.length - b.moves.length);
  interface Four {
    p: Partial;
    state: Uint8Array;
    moves: Move[];
    lengths: number[];
    cb: number;
  }
  const four: Four[] = [];
  for (const p of firstTwo.slice(0, keep)) {
    const parity12 = movesParity(p.moves);
    for (const a of scheme.assignments) {
      if (a[U] !== p.cu) continue;
      const s3 = solveFace(tables[3] as BarTable[], p.state, a[F] as number, wantParity, parity12);
      if (!s3) continue;
      const s4 = solveFace(tables[4] as BarTable[], s3.state, a[R] as number, -1, 0);
      if (!s4) continue;
      plans++;
      four.push({ p, state: s4.state, moves: [...p.moves, ...s3.moves, ...s4.moves], lengths: [...p.lengths, s3.moves.length, s4.moves.length], cb: a[B] as number });
    }
  }
  four.sort((a, b) => a.moves.length - b.moves.length);
  let best: { moves: Move[]; lengths: number[]; rot: number } | null = null;
  let tried = 0;
  for (const f of four) {
    if (best && f.moves.length + 6 >= best.moves.length) break;
    if (tried >= 6 && best) break;
    tried++;
    const l2 = solveLastTwoCentres(f.state, f.cb, best ? 300000 : 20000000);
    if (!l2) continue;
    const total = f.moves.length + l2.length;
    if (!best || total < best.moves.length) best = { moves: [...f.moves, ...l2], lengths: [...f.lengths, l2.length], rot: f.p.rot };
  }
  if (!best) throw new Error('centre solver found no plan');
  const rot = ROTATIONS[best.rot] as (typeof ROTATIONS)[number];
  const moves = best.moves.map((m) => moveToOriginal(rot, m));
  return { moves, stageLengths: best.lengths, plansTried: plans };
}

/** True when every face's 4x4 centre block is a single colour. */
export function centresSolved(state: ArrayLike<number>): boolean {
  for (let f = 0; f < 6; f++) if (!faceDone(state, f, state[f * NN + 7] as number)) return false;
  return true;
}

void R;
void D;
