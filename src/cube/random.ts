/**
 * Random cube states for tests and the demo scramble.
 *
 * randomState draws every piece position independently (a uniformly random reachable state): corners
 * with a random permutation and twists that sum to a multiple of three, each wing orbit with a random
 * permutation, and each centre orbit with a random arrangement. On a 6x6x6 with indistinguishable
 * centre pieces the corner twist is the only constraint, so every such state can be solved.
 */
import { NF, solvedState } from './geometry';
import { CORNERS, WINGS, CENTRES } from './pieces';

function shuffle<T>(a: T[], rand: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

/** A uniformly random solvable state. `colours` optionally gives the colour on each face of the solved cube. */
export function randomState(rand: () => number, colours?: readonly number[]): Uint8Array {
  const solved = solvedState();
  if (colours) for (let i = 0; i < NF; i++) solved[i] = colours[solved[i] as number] as number;
  const out = new Uint8Array(NF);
  // Corners
  const order = shuffle([0, 1, 2, 3, 4, 5, 6, 7], rand);
  let twistSum = 0;
  for (let slot = 0; slot < 8; slot++) {
    const piece = CORNERS[order[slot] as number] as (typeof CORNERS)[number];
    const twist = slot < 7 ? Math.floor(rand() * 3) : (3 - (twistSum % 3)) % 3;
    twistSum += twist;
    const target = CORNERS[slot] as (typeof CORNERS)[number];
    for (let k = 0; k < 3; k++) out[target.facelets[(k + twist) % 3] as number] = solved[piece.facelets[k] as number] as number;
  }
  // Wings: a piece keeps its handed order wherever it goes.
  for (let orbit = 0; orbit < 2; orbit++) {
    const slots = WINGS.filter((w) => w.orbit === orbit);
    const pieces = shuffle(slots.slice(), rand);
    slots.forEach((slot, i) => {
      const piece = pieces[i] as (typeof WINGS)[number];
      out[slot.handed[0]] = solved[piece.handed[0]] as number;
      out[slot.handed[1]] = solved[piece.handed[1]] as number;
    });
  }
  // Centres
  for (let orbit = 0; orbit < 4; orbit++) {
    const slots = CENTRES.filter((c) => c.orbit === orbit);
    const cols = shuffle(slots.map((c) => solved[c.facelet] as number), rand);
    slots.forEach((slot, i) => {
      out[slot.facelet] = cols[i] as number;
    });
  }
  return out;
}
