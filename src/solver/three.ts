/**
 * Final stage: with centres solved and edges paired, the 6x6x6 behaves like a 3x3x3 under outer turns.
 * The 3x3x3 is solved by Kociemba's two-phase algorithm (cubejs).
 *
 * An even cube has one more hurdle that a real 3x3x3 never shows: the corner permutation and the
 * edge-group permutation can have different parity ("PLL parity"). It is fixed by a short sequence of
 * half turns that swaps two opposite edge groups and leaves everything else in place.
 */
import Cube from 'cubejs';
import { NN, faceletIndex } from '../cube/geometry';
import { parseMoves, type Move } from '../cube/moves';

let ready = false;

export function prepareThree(): void {
  if (!ready) {
    Cube.initSolver();
    ready = true;
  }
}

const PICK = [0, 2, 5];

/** The 54 facelets of the reduced cube in cubejs order (URFDLB, row by row), as face letters. */
export function reducedFacelets(state: ArrayLike<number>): string {
  const letter = new Array<string>(6).fill('?');
  for (let f = 0; f < 6; f++) letter[state[f * NN + 14] as number] = 'URFDLB'[f] as string;
  let out = '';
  for (let f = 0; f < 6; f++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out += letter[state[faceletIndex(f, PICK[r] as number, PICK[c] as number)] as number];
  return out;
}

function permParity(p: readonly number[]): number {
  const seen = new Array<boolean>(p.length).fill(false);
  let parity = 0;
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = p[j] as number) {
      seen[j] = true;
      len++;
    }
    parity ^= (len + 1) & 1;
  }
  return parity;
}

export interface ReducedInfo {
  facelets: string;
  cornerTwist: number;
  edgeFlip: number;
  cornerParity: number;
  edgeParity: number;
}

export function analyseReduced(state: ArrayLike<number>): ReducedInfo {
  const facelets = reducedFacelets(state);
  const j = Cube.fromString(facelets).toJSON();
  return {
    facelets,
    cornerTwist: j.co.reduce((a, b) => a + b, 0) % 3,
    edgeFlip: j.eo.reduce((a, b) => a + b, 0) % 2,
    cornerParity: permParity(j.cp),
    edgeParity: permParity(j.ep),
  };
}

/**
 * Changes the parity of the edge groups against the corners, which is all the solver needs from it:
 * it swaps the top-left and top-right edge groups and the top corners diagonally (the same as swapping
 * the top-front and top-back groups and then giving the top a half turn). Centres stay whole and every
 * other edge group stays paired. tests/learn.test.ts checks this piece by piece.
 */
export const PLL_PARITY_FIX: Move[] = parseMoves('2-3Rw2 U2 2-3Rw2 3Uw2 2-3Rw2 3Uw2');

/** Outer-turn solution of the reduced cube. The reduced cube must be a valid 3x3x3 state. */
export function solveReduced(facelets: string): Move[] {
  prepareThree();
  const cube = Cube.fromString(facelets);
  if (cube.isSolved()) return [];
  const text = cube.solve(22);
  return parseMoves(text);
}
