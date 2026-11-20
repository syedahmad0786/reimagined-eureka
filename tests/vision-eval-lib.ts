/** Shared by the vision evaluation scripts. */
import type { Classification } from '../src/vision/index';

const PERMS: number[][] = [];
(function build(p: number[], rest: number[]): void {
  if (!rest.length) {
    PERMS.push(p);
    return;
  }
  rest.forEach((v, i) => build([...p, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
})([], [0, 1, 2, 3, 4, 5]);

/** Colour ids are arbitrary, so they are matched to the true colours by best agreement before counting. */
export function compare(result: Classification, truth: ArrayLike<number>): { wrong: number[]; mapping: number[] } {
  const agree = new Int32Array(36);
  for (let i = 0; i < 216; i++) agree[(result.labels[i] as number) * 6 + (truth[i] as number)] += 1;
  let best = PERMS[0] as number[];
  let bestScore = -1;
  for (const p of PERMS) {
    let s = 0;
    for (let k = 0; k < 6; k++) s += agree[k * 6 + (p[k] as number)] as number;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  const wrong: number[] = [];
  for (let i = 0; i < 216; i++) if (best[result.labels[i] as number] !== truth[i]) wrong.push(i);
  return { wrong, mapping: best };
}

