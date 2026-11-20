import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { solvedState, isSolved } from '../src/cube/geometry';
import { applyMoves, randomMoves, makeRng, parseMoves, isNameable } from '../src/cube/moves';
import { RefCube } from '../src/cube/reference';
import { randomState } from '../src/cube/random';
import { ROTATIONS, rotateState } from '../src/cube/rotations';
import { solveCube, prepareSolver, UnsolvableError } from '../src/solver/index';
import { optimizeMoves } from '../src/solver/optimize';
import { PLL_PARITY_FIX } from '../src/solver/three';
import { edgesPaired } from '../src/solver/edges';
import { centresSolved } from '../src/solver/centre-plan';

const TRIALS = Number(process.env.SOLVER_TRIALS ?? 300);
const SEED = Number(process.env.SOLVER_SEED ?? 2026);

function shuffled(rand: () => number): number[] {
  const a = [0, 1, 2, 3, 4, 5];
  for (let i = 5; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe('solver', () => {
  it('keeps a solved cube solved with zero steps', () => {
    prepareSolver();
    expect(solveCube(solvedState()).steps.length).toBe(0);
  });

  it('the parity fix swaps two edge groups and nothing else', () => {
    const s = applyMoves(solvedState(), PLL_PARITY_FIX);
    expect(isSolved(s)).toBe(false);
    expect(centresSolved(s)).toBe(true);
    expect(edgesPaired(s)).toBe(true);
    let changed = 0;
    const ref = solvedState();
    for (let i = 0; i < s.length; i++) if (s[i] !== ref[i]) changed++;
    // two groups of four wings, two stickers each
    expect(changed).toBe(16);
  });

  it('merging and cancelling moves never changes what a sequence does', () => {
    const rand = makeRng(4);
    for (let t = 0; t < 200; t++) {
      const moves = randomMoves(60, rand);
      // add deliberate same-axis runs and cancellations
      const extra = parseMoves("R 2R 3R Lw' 2L' R' U U' 3Uw 2U' F2 F2 B 2-3Bw 3Rw 3Rw'");
      const all = [...moves.slice(0, 30), ...extra, ...moves.slice(30)];
      const merged = optimizeMoves(all.map((move) => ({ move, phase: 'x' }))).map((x) => x.move);
      expect(merged.length).toBeLessThanOrEqual(all.length);
      for (const m of merged) expect(isNameable(m)).toBe(true);
      const start = new Uint8Array(216);
      for (let i = 0; i < 216; i++) start[i] = i;
      expect(Array.from(applyMoves(start, merged))).toEqual(Array.from(applyMoves(start, all)));
    }
    const merged = optimizeMoves(parseMoves("R 2R U U' 3R L L'").map((move) => ({ move, phase: 'x' })));
    expect(merged.length).toBe(1);
  });

  it('rejects impossible states with a clear error', () => {
    const s = solvedState();
    s[0] = 1;
    expect(() => solveCube(s)).toThrow(UnsolvableError);
    // one corner twisted in place
    const t = solvedState();
    const a = t[5]!;
    t[5] = t[36]!;
    t[36] = t[72 + 5]!;
    t[72 + 5] = a;
    expect(() => solveCube(t)).toThrow(UnsolvableError);
  });

  it('solves ' + TRIALS + ' random cubes; every solution is replayed on the reference engine', () => {
    prepareSolver();
    const rand = makeRng(SEED);
    const lengths: number[] = [];
    const times: number[] = [];
    const phases = { centres: 0, edges: 0, parity: 0, '3x3': 0 };
    let parityCases = 0;
    for (let i = 0; i < TRIALS; i++) {
      // Alternate between long random-move scrambles and uniformly random states, on random colour
      // labellings and in random orientations, so no colour is tied to a face.
      const colours = shuffled(rand);
      let state: Uint8Array;
      if (i % 2 === 0) {
        state = solvedState();
        for (let k = 0; k < state.length; k++) state[k] = colours[state[k]!]!;
        state = applyMoves(state, randomMoves(150, rand));
      } else {
        state = randomState(rand, colours);
      }
      state = rotateState(ROTATIONS[Math.floor(rand() * 24)]!, state);
      const result = solveCube(state);
      const moves = result.steps.map((s) => s.move);
      for (const m of moves) {
        expect(isNameable(m)).toBe(true);
        expect(m.hi - m.lo).toBeLessThan(3);
      }
      expect(new RefCube(state).applyAll(moves).isSolved(), 'scramble ' + i).toBe(true);
      lengths.push(moves.length);
      times.push(result.ms);
      for (const k of Object.keys(phases) as (keyof typeof phases)[]) phases[k] += result.counts[k];
      if (result.raw.parity > 0) parityCases++;
    }
    lengths.sort((a, b) => a - b);
    times.sort((a, b) => a - b);
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    const report = {
      trials: TRIALS,
      seed: SEED,
      solved: lengths.length,
      steps: { mean: +mean(lengths).toFixed(1), min: lengths[0], median: lengths[lengths.length >> 1], p95: lengths[Math.floor(lengths.length * 0.95)], max: lengths[lengths.length - 1] },
      ms: { mean: +mean(times).toFixed(0), median: +times[times.length >> 1]!.toFixed(0), p95: +times[Math.floor(times.length * 0.95)]!.toFixed(0), max: +times[times.length - 1]!.toFixed(0) },
      meanStepsByPhase: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, +(v / TRIALS).toFixed(1)])),
      parityFixes: parityCases,
    };
    mkdirSync('tmp', { recursive: true });
    writeFileSync('tmp/solver-report-' + TRIALS + '.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    expect(lengths.length).toBe(TRIALS);
  }, 120000 + TRIALS * 3000);
});
