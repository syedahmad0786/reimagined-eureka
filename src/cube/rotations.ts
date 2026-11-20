/**
 * The 24 whole-cube rotations. The solver never asks the user to rotate the cube; rotations are used
 * internally to reuse one set of lookup tables for every choice of "which face first".
 */
import { N, NF, FACE_NORMALS, faceOfNormal, type Vec3 } from './geometry';
import { movePerm, composePerm, identityPerm, type Move, type Axis } from './moves';

export interface Rotation {
  index: number;
  /** Facelet permutation in pull form: rotated[i] = original[perm[i]]. */
  perm: Uint8Array;
  inverse: Uint8Array;
  /** matrix[r][c]: the rotated position is matrix * position. */
  matrix: number[][];
  /** faceTo[f] = where face f ends up. */
  faceTo: number[];
}

function mul(a: number[][], b: number[][]): number[][] {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) (out[i] as number[])[j] = ((out[i] as number[])[j] as number) + ((a[i] as number[])[k] as number) * ((b[k] as number[])[j] as number);
  return out;
}

// Quarter turn clockwise seen from the positive end of each axis (same convention as moves.ts).
const QUARTER: number[][][] = [
  [
    [1, 0, 0],
    [0, 0, 1],
    [0, -1, 0],
  ],
  [
    [0, 0, -1],
    [0, 1, 0],
    [1, 0, 0],
  ],
  [
    [0, 1, 0],
    [-1, 0, 0],
    [0, 0, 1],
  ],
];

function buildRotations(): Rotation[] {
  const out: Rotation[] = [];
  const seen = new Map<string, number>();
  const queue: { perm: Uint8Array; matrix: number[][] }[] = [
    {
      perm: identityPerm(),
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
  ];
  while (queue.length) {
    const cur = queue.shift() as { perm: Uint8Array; matrix: number[][] };
    const key = cur.matrix.flat().join(',');
    if (seen.has(key)) continue;
    seen.set(key, out.length);
    const inverse = new Uint8Array(NF);
    for (let i = 0; i < NF; i++) inverse[cur.perm[i] as number] = i;
    const faceTo: number[] = [];
    for (let f = 0; f < 6; f++) {
      const n = FACE_NORMALS[f] as Vec3;
      const r: Vec3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) r[i] = ((cur.matrix[i] as number[])[0] as number) * n[0] + ((cur.matrix[i] as number[])[1] as number) * n[1] + ((cur.matrix[i] as number[])[2] as number) * n[2];
      faceTo.push(faceOfNormal(r));
    }
    out.push({ index: out.length, perm: cur.perm, inverse, matrix: cur.matrix, faceTo });
    for (let axis = 0 as Axis; axis < 3; axis++) {
      queue.push({
        perm: composePerm(cur.perm, movePerm({ axis, lo: 0, hi: N - 1, q: 1 })),
        matrix: mul(QUARTER[axis] as number[][], cur.matrix),
      });
    }
  }
  if (out.length !== 24) throw new Error('expected 24 rotations, got ' + out.length);
  return out;
}

export const ROTATIONS: Rotation[] = buildRotations();

/**
 * Translate a move made on the rotated cube back to the equivalent move on the original cube:
 * rotate(apply(original, toOriginal(m))) equals apply(rotate(original), m).
 */
export function moveToOriginal(rot: Rotation, m: Move): Move {
  // Find the original axis a with matrix * e_a = +-e_(m.axis).
  for (let a = 0; a < 3; a++) {
    const v = (rot.matrix[m.axis] as number[])[a] as number;
    if (v === 1) return { axis: a as Axis, lo: m.lo, hi: m.hi, q: m.q };
    if (v === -1) return { axis: a as Axis, lo: N - 1 - m.hi, hi: N - 1 - m.lo, q: (4 - m.q) & 3 };
  }
  throw new Error('bad rotation matrix');
}

export function rotateState(rot: Rotation, state: Uint8Array): Uint8Array {
  const out = new Uint8Array(NF);
  const p = rot.perm;
  for (let i = 0; i < NF; i++) out[i] = state[p[i] as number] as number;
  return out;
}
