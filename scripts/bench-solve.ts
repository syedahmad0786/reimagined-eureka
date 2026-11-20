import { solvedState } from '../src/cube/geometry';
import { applyMoves, randomMoves, makeRng } from '../src/cube/moves';
import { solveCube, prepareSolver } from '../src/solver/index';

let t0 = performance.now();
prepareSolver();
console.log('prepare', (performance.now() - t0).toFixed(0), 'ms');
const rand = makeRng(Number(process.argv[2] ?? 1));
const trials = Number(process.argv[3] ?? 50);
const lens: number[] = [];
const times: number[] = [];
const raw = { centres: 0, edges: 0, parity: 0, three: 0 };
const ph = { centres: 0, edges: 0, parity: 0, '3x3': 0 };
for (let i = 0; i < trials; i++) {
  const state = applyMoves(solvedState(), randomMoves(120, rand));
  const r = solveCube(state);
  lens.push(r.steps.length);
  times.push(r.ms);
  raw.centres += r.raw.centres; raw.edges += r.raw.edges; raw.parity += r.raw.parity; raw.three += r.raw.three;
  for (const k of Object.keys(ph) as (keyof typeof ph)[]) ph[k] += r.counts[k];
}
lens.sort((a, b) => a - b);
times.sort((a, b) => a - b);
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('solved', trials, 'steps avg', avg(lens).toFixed(1), 'min', lens[0], 'median', lens[lens.length >> 1], 'max', lens[lens.length - 1]);
console.log('time ms avg', avg(times).toFixed(0), 'p95', times[Math.floor(times.length * 0.95)]!.toFixed(0), 'max', times[times.length - 1]!.toFixed(0));
console.log('raw per stage', Object.entries(raw).map(([k, v]) => k + ' ' + (v / trials).toFixed(1)).join(', '));
console.log('merged per phase', Object.entries(ph).map(([k, v]) => k + ' ' + (v / trials).toFixed(1)).join(', '));
