import { solvedState, NN } from '../src/cube/geometry';
import { applyMoves, randomMoves, makeRng, type Move } from '../src/cube/moves';
import { barTables, solveBarByTable } from '../src/solver/bars';
import { solveLastTwoCentres, prepareLastTwo } from '../src/solver/centres';
prepareLastTwo();

const t0 = performance.now();
const tables = barTables();
console.log('tables built in', (performance.now() - t0).toFixed(0), 'ms');
for (let s = 1; s <= 5; s++)
  for (let b = 1; b <= 4; b++) {
    const t = tables[s]![b]!;
    let reach = 0;
    let max = 0;
    for (const v of t.dist) if (v !== 255) { reach++; if (v > max) max = v; }
    console.log('stage', s, 'bar', b, 'gens', t.gens.length, 'reachable', reach, 'max dist', max);
  }
const colours = [-1, 0, 3, 2, 1, 5];
const faces = [-1, 0, 3, 2, 1, 5];
const rand = makeRng(Number(process.argv[2] ?? 1));
const trials = Number(process.argv[3] ?? 200);
const per = [0, 0, 0, 0, 0, 0];
const fails = [0, 0, 0, 0, 0, 0];
let total = 0, worst = 0, done = 0, l2ms = 0;
const tAll = performance.now();
for (let trial = 0; trial < trials; trial++) {
  let state = applyMoves(solvedState(), randomMoves(100, rand));
  let count = 0;
  let ok = true;
  for (let s = 1; s <= 4 && ok; s++) {
    const remaining = new Set([1, 2, 3, 4]);
    while (remaining.size && ok) {
      let best: { bar: number; moves: Move[]; cost: number } | null = null;
      for (const bar of remaining) {
        const r = solveBarByTable(tables[s]![bar]!, state, colours[s]!, -1);
        if (r && (!best || r.cost < best.cost)) best = { bar, moves: r.moves, cost: r.cost };
      }
      if (!best) { ok = false; fails[s]!++; break; }
      state = applyMoves(state, best.moves);
      remaining.delete(best.bar);
      count += best.moves.length;
      per[s]! += best.moves.length;
    }
    if (ok) for (let k = 1; k <= s; k++) { const f = faces[k]!; for (let r = 1; r <= 4; r++) for (let c = 1; c <= 4; c++) if (state[f * NN + r * 6 + c] !== colours[k]) throw new Error('stage ' + s + ' left face ' + f + ' wrong, trial ' + trial); }
  }
  if (ok) { const tt = performance.now(); const l2 = solveLastTwoCentres(state, 5); l2ms += performance.now() - tt; if (!l2) { ok = false; fails[5]!++; } else { state = applyMoves(state, l2); count += l2.length; per[5]! += l2.length; for (const f of [4, 5]) for (let r = 1; r <= 4; r++) for (let c = 1; c <= 4; c++) if (state[f * NN + r * 6 + c] !== f) throw new Error('l2c wrong'); } }
  if (ok) { total += count; worst = Math.max(worst, count); done++; }
}
console.log('solved', done, 'of', trials, 'avg', (total / done).toFixed(1), 'worst', worst, 'ms per solve', ((performance.now() - tAll) / trials).toFixed(2));
console.log('l2c ms avg', (l2ms / trials).toFixed(2));
console.log('per stage avg (over all trials):', per.slice(1).map((v) => (v / trials).toFixed(1)).join(' '), 'fails', fails.slice(1).join(' '));
