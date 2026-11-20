import { solvedState } from '../src/cube/geometry';
import { applyMoves, randomMoves, makeRng } from '../src/cube/moves';
import { deriveScheme, analyseWings } from '../src/cube/scheme';
import { solveCentres, prepareCentres, centresSolved } from '../src/solver/centre-plan';
import { pairEdges, prepareEdges, edgesPaired } from '../src/solver/edges';

prepareCentres();
let t0 = performance.now();
prepareEdges();
console.log('edge prepare', (performance.now() - t0).toFixed(0), 'ms');
const rand = makeRng(Number(process.argv[2] ?? 1));
const trials = Number(process.argv[3] ?? 50);
const width = Number(process.argv[4] ?? 48);
let total = 0, worst = 0, fails = 0, ms = 0, maxMs = 0, exp = 0;
for (let i = 0; i < trials; i++) {
  const state = applyMoves(solvedState(), randomMoves(100, rand));
  const scheme = deriveScheme(state).scheme!;
  const wings = analyseWings(state, scheme);
  const sol = solveCentres(state, scheme, (wings.odd[0] ? 1 : 0) | (wings.odd[1] ? 2 : 0));
  const mid = applyMoves(state, sol.moves);
  const t = performance.now();
  const r = pairEdges(mid, { width });
  const dt = performance.now() - t;
  ms += dt;
  maxMs = Math.max(maxMs, dt);
  if (!r) { fails++; console.log('FAIL trial', i); continue; }
  const after = applyMoves(mid, r.moves);
  if (!centresSolved(after)) throw new Error('centres broken, trial ' + i);
  if (!edgesPaired(after)) throw new Error('edges not paired, trial ' + i);
  total += r.moves.length;
  worst = Math.max(worst, r.moves.length);
  exp += r.expanded;
}
console.log('width', width, 'paired', trials - fails, 'of', trials, 'avg moves', (total / (trials - fails)).toFixed(1), 'worst', worst, 'avg ms', (ms / trials).toFixed(0), 'max ms', maxMs.toFixed(0), 'avg expanded', (exp / (trials - fails)).toFixed(0));
