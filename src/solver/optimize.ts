/**
 * Shortens a move sequence without changing what it does.
 *
 * Turns about the same axis commute, so every run of same-axis moves is reduced to "how far has each
 * of the six layers turned in total" and then written out again with the fewest block turns. This
 * cancels moves that undo each other (also across a gap of same-axis moves) and merges neighbouring
 * layers that turn together into one step, for example R followed by 2R becomes Rw.
 * Blocks never cross the middle of the cube, and no whole-cube rotations are produced.
 */
import { N } from '../cube/geometry';
import type { Move, Axis } from '../cube/moves';

const HALF = N / 2;

/** For a half (three layers, outer first), the fewest block turns giving each combination of layer amounts. */
const HALF_PLAN: [number, number, number][][] = [];
{
  // state code = a + 4b + 16c for layer amounts (outer, middle, inner)
  const best: ([number, number, number][] | null)[] = new Array(64).fill(null);
  best[0] = [];
  let frontier = [0];
  while (frontier.length) {
    const next: number[] = [];
    for (const code of frontier) {
      const amounts = [code & 3, (code >> 2) & 3, (code >> 4) & 3];
      for (let from = 0; from < HALF; from++)
        for (let to = from; to < HALF; to++)
          for (let q = 1; q <= 3; q++) {
            const a = amounts.slice();
            for (let l = from; l <= to; l++) a[l] = ((a[l] as number) + q) & 3;
            const nc = (a[0] as number) + 4 * (a[1] as number) + 16 * (a[2] as number);
            if (best[nc] === null) {
              best[nc] = [...(best[code] as [number, number, number][]), [from, to, q]];
              next.push(nc);
            }
          }
      }
    frontier = next;
  }
  for (let i = 0; i < 64; i++) HALF_PLAN.push(best[i] as [number, number, number][]);
}

export interface TaggedMove {
  move: Move;
  phase: string;
}

interface Group {
  axis: Axis;
  amounts: number[];
  /** Phase of the earliest surviving contribution to each layer. */
  phase: string;
}

function emit(g: Group): TaggedMove[] {
  const out: TaggedMove[] = [];
  // Negative half: layers 0 (outer), 1, 2. Positive half: layers 5 (outer), 4, 3.
  const neg = (g.amounts[0] as number) + 4 * (g.amounts[1] as number) + 16 * (g.amounts[2] as number);
  for (const [from, to, q] of HALF_PLAN[neg] as [number, number, number][]) out.push({ move: { axis: g.axis, lo: from, hi: to, q }, phase: g.phase });
  const pos = (g.amounts[5] as number) + 4 * (g.amounts[4] as number) + 16 * (g.amounts[3] as number);
  for (const [from, to, q] of HALF_PLAN[pos] as [number, number, number][]) out.push({ move: { axis: g.axis, lo: N - 1 - to, hi: N - 1 - from, q }, phase: g.phase });
  return out;
}

export function optimizeMoves(input: readonly TaggedMove[]): TaggedMove[] {
  const groups: Group[] = [];
  for (const { move, phase } of input) {
    let top = groups[groups.length - 1];
    if (!top || top.axis !== move.axis) {
      top = { axis: move.axis, amounts: [0, 0, 0, 0, 0, 0], phase };
      groups.push(top);
    }
    for (let l = move.lo; l <= move.hi; l++) top.amounts[l] = ((top.amounts[l] as number) + move.q) & 3;
    if (top.amounts.every((a) => a === 0)) groups.pop();
  }
  const out: TaggedMove[] = [];
  for (const g of groups) for (const t of emit(g)) out.push(t);
  return out;
}
