/**
 * Balanced assignment: every sample gets one of k labels and every label is used exactly cap times,
 * at minimum total cost. Solved exactly by cycle cancelling on the k-node label graph: a move of one
 * sample from label a to label b is an arc a -> b whose weight is the cheapest such move, and the
 * assignment is optimal exactly when that graph has no negative cycle.
 */

const cycleCache = new Map<number, number[][]>();

function simpleCycles(k: number): number[][] {
  const cached = cycleCache.get(k);
  if (cached) return cached;
  const out: number[][] = [];
  const path: number[] = [];
  const used = new Array<boolean>(k).fill(false);
  const extend = (start: number): void => {
    if (path.length >= 2) out.push(path.slice());
    for (let next = start + 1; next < k; next++) {
      if (used[next]) continue;
      used[next] = true;
      path.push(next);
      extend(start);
      path.pop();
      used[next] = false;
    }
  };
  // Each cycle is listed once, starting from its smallest node.
  for (let start = 0; start < k; start++) {
    path.length = 0;
    path.push(start);
    used.fill(false);
    used[start] = true;
    extend(start);
  }
  cycleCache.set(k, out);
  return out;
}

/**
 * cost is n x k, row-major. labels may hold a balanced warm start; pass warm = false to build a
 * greedy start instead. Returns the total cost.
 */
export function balancedAssign(cost: Float32Array | Float64Array, n: number, k: number, labels: Uint8Array, warm: boolean): number {
  const cap = n / k;
  if (!Number.isInteger(cap)) throw new Error('balancedAssign: n must be a multiple of k');
  if (!warm) {
    // Greedy start: the samples with most to lose choose first.
    const order = new Array<number>(n);
    const regret = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      order[i] = i;
      let best = Infinity;
      let second = Infinity;
      for (let c = 0; c < k; c++) {
        const v = cost[i * k + c] as number;
        if (v < best) {
          second = best;
          best = v;
        } else if (v < second) second = v;
      }
      regret[i] = second - best;
    }
    order.sort((a, b) => (regret[b] as number) - (regret[a] as number));
    const room = new Array<number>(k).fill(cap);
    for (const i of order) {
      let best = -1;
      let bestCost = Infinity;
      for (let c = 0; c < k; c++) {
        if ((room[c] as number) > 0 && (cost[i * k + c] as number) < bestCost) {
          bestCost = cost[i * k + c] as number;
          best = c;
        }
      }
      labels[i] = best;
      room[best] = (room[best] as number) - 1;
    }
  }
  const cycles = simpleCycles(k);
  const move = new Float64Array(k * k);
  const who = new Int32Array(k * k);
  for (let guard = 0; guard < 20000; guard++) {
    move.fill(Infinity);
    for (let i = 0; i < n; i++) {
      const a = labels[i] as number;
      const base = cost[i * k + a] as number;
      for (let b = 0; b < k; b++) {
        if (b === a) continue;
        const d = (cost[i * k + b] as number) - base;
        if (d < (move[a * k + b] as number)) {
          move[a * k + b] = d;
          who[a * k + b] = i;
        }
      }
    }
    let bestGain = -1e-9;
    let bestCycle: number[] | null = null;
    for (const cyc of cycles) {
      let s = 0;
      for (let j = 0; j < cyc.length; j++) s += move[(cyc[j] as number) * k + (cyc[(j + 1) % cyc.length] as number)] as number;
      if (s < bestGain) {
        bestGain = s;
        bestCycle = cyc;
      }
    }
    if (!bestCycle) break;
    const picks: number[] = [];
    for (let j = 0; j < bestCycle.length; j++) picks.push(who[(bestCycle[j] as number) * k + (bestCycle[(j + 1) % bestCycle.length] as number)] as number);
    for (let j = 0; j < bestCycle.length; j++) labels[picks[j] as number] = bestCycle[(j + 1) % bestCycle.length] as number;
  }
  let total = 0;
  for (let i = 0; i < n; i++) total += cost[i * k + (labels[i] as number)] as number;
  return total;
}
