import { solvedState } from '../src/cube/geometry';
import { applyMoves, randomMoves, makeRng } from '../src/cube/moves';
import { deriveScheme, analyseWings } from '../src/cube/scheme';
import { solveCentres, prepareCentres, centresSolved } from '../src/solver/centre-plan';

let t0 = performance.now();
prepareCentres();
console.log('prepare', (performance.now() - t0).toFixed(0), 'ms');
const rand = makeRng(Number(process.argv[2] ?? 1));
const trials = Number(process.argv[3] ?? 100);
const keep = Number(process.argv[4] ?? 10);
let total = 0, worst = 0, maxMs = 0;
const stage = [0, 0, 0, 0, 0];
t0 = performance.now();
for (let i = 0; i < trials; i++) {
  const state = applyMoves(solvedState(), randomMoves(100, rand));
  const scheme = deriveScheme(state).scheme!;
  const wings = analyseWings(state, scheme);
  if (!wings.valid) throw new Error('wings invalid');
  const want = (wings.odd[0] ? 1 : 0) | (wings.odd[1] ? 2 : 0);
  const t = performance.now();
  const sol = solveCentres(state, scheme, want, keep);
  maxMs = Math.max(maxMs, performance.now() - t);
  const after = applyMoves(state, sol.moves);
  if (!centresSolved(after)) throw new Error('centres not solved, trial ' + i);
  const w2 = analyseWings(after, scheme);
  if (w2.odd[0] || w2.odd[1]) throw new Error('wing parity still odd, trial ' + i);
  total += sol.moves.length;
  worst = Math.max(worst, sol.moves.length);
  sol.stageLengths.forEach((v, k) => (stage[k]! += v));
}
console.log('keep', keep, 'avg', (total / trials).toFixed(1), 'worst', worst, 'avg ms', ((performance.now() - t0) / trials).toFixed(1), 'max ms', maxMs.toFixed(0), 'stages', stage.map((v) => (v / trials).toFixed(1)).join(' '));
