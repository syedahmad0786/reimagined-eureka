/**
 * The 6x6x6 solver: reduction method.
 *
 *   1. centres   six single-coloured 4x4 blocks (bars.ts, centres.ts, centre-plan.ts)
 *   2. edges     twelve groups of four matching wings (edges.ts)
 *   3. 3x3       outer turns only, two-phase algorithm, with the even-cube parity fix (three.ts)
 *
 * The result is a list of steps, one physical turn each, with cancelled and merged moves (optimize.ts).
 * Every solution is replayed on the independent reference engine before it is returned.
 */
import { NF, isSolved } from '../cube/geometry';
import { applyMoves, moveToString, type Move } from '../cube/moves';
import { RefCube } from '../cube/reference';
import { deriveScheme, analyseWings, cornerTwist, colourCounts } from '../cube/scheme';
import { solveCentres, prepareCentres, centresSolved } from './centre-plan';
import { pairEdges, prepareEdges, edgesPaired } from './edges';
import { analyseReduced, solveReduced, prepareThree, PLL_PARITY_FIX } from './three';
import { optimizeMoves, type TaggedMove } from './optimize';

export type Phase = 'centres' | 'edges' | 'parity' | '3x3';

export interface SolveStep {
  move: Move;
  notation: string;
  phase: Phase;
}

export interface SolveResult {
  steps: SolveStep[];
  /** Steps per phase after merging. */
  counts: Record<Phase, number>;
  /** Raw move counts per stage before merging, for diagnostics. */
  raw: { centres: number; edges: number; parity: number; three: number };
  ms: number;
}

export class UnsolvableError extends Error {}

let prepared = false;

/** Build every lookup table (about a second on a laptop). Safe to call more than once. */
export function prepareSolver(): void {
  if (prepared) return;
  prepareCentres();
  prepareEdges();
  prepareThree();
  prepared = true;
}

export function solveCube(state: Uint8Array): SolveResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  prepareSolver();
  if (state.length !== NF) throw new UnsolvableError('A cube state needs 216 stickers.');
  const counts = colourCounts(state);
  if (counts.some((c) => c !== 36)) throw new UnsolvableError('Each colour must appear exactly 36 times.');
  const { scheme } = deriveScheme(state);
  if (!scheme) throw new UnsolvableError('The corner pieces do not form a consistent colour scheme.');
  if (cornerTwist(state, scheme) !== 0) throw new UnsolvableError('A corner piece is twisted.');
  const wings = analyseWings(state, scheme);
  if (!wings.valid) throw new UnsolvableError('The edge pieces are not a valid set.');

  const tagged: TaggedMove[] = [];
  let cur = state;
  const centres = solveCentres(cur, scheme, (wings.odd[0] ? 1 : 0) | (wings.odd[1] ? 2 : 0));
  cur = applyMoves(cur, centres.moves);
  if (!centresSolved(cur)) throw new Error('internal: centres not solved');
  for (const m of centres.moves) tagged.push({ move: m, phase: 'centres' });

  const edges = pairEdges(cur);
  if (!edges) throw new Error('internal: edge pairing did not finish');
  cur = applyMoves(cur, edges.moves);
  if (!edgesPaired(cur) || !centresSolved(cur)) throw new Error('internal: edges not paired');
  for (const m of edges.moves) tagged.push({ move: m, phase: 'edges' });

  let info = analyseReduced(cur);
  if (info.cornerTwist !== 0) throw new UnsolvableError('A corner piece is twisted.');
  if (info.edgeFlip !== 0) throw new Error('internal: edge flip parity');
  let parityMoves = 0;
  if (info.cornerParity !== info.edgeParity) {
    cur = applyMoves(cur, PLL_PARITY_FIX);
    for (const m of PLL_PARITY_FIX) tagged.push({ move: m, phase: 'parity' });
    parityMoves = PLL_PARITY_FIX.length;
    info = analyseReduced(cur);
    if (info.cornerParity !== info.edgeParity || !edgesPaired(cur) || !centresSolved(cur)) throw new Error('internal: parity fix failed');
  }
  const three = solveReduced(info.facelets);
  for (const m of three) tagged.push({ move: m, phase: '3x3' });

  const merged = optimizeMoves(tagged);
  const steps: SolveStep[] = merged.map((t) => ({ move: t.move, notation: moveToString(t.move), phase: t.phase as Phase }));
  // Independent check: replay on the reference engine.
  const check = new RefCube(state).applyAll(steps.map((s) => s.move));
  if (!check.isSolved()) throw new Error('internal: solution does not solve the cube');
  if (!isSolved(applyMoves(state, steps.map((s) => s.move)))) throw new Error('internal: engines disagree');
  const phaseCounts: Record<Phase, number> = { centres: 0, edges: 0, parity: 0, '3x3': 0 };
  for (const s of steps) phaseCounts[s.phase]++;
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { steps, counts: phaseCounts, raw: { centres: centres.moves.length, edges: edges.moves.length, parity: parityMoves, three: three.length }, ms: t1 - t0 };
}
