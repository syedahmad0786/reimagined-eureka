/**
 * Geometry and facelet conventions for the 6x6x6 cube. Everything else in the app builds on this file.
 *
 * Axes: x points right (L -> R), y points up (D -> U), z points toward the viewer (B -> F).
 * A cubie is addressed by integer coordinates (x, y, z), each 0..5.
 *
 * A cube state is a Uint8Array of 216 facelets. Index = face * 36 + row * 6 + col, with faces in the
 * order U R F D L B (the Kociemba order) and each face read row by row as seen from outside:
 *
 *   U: seen from above with F at the bottom of the view  (row 0 touches B, col 0 touches L)
 *   R: seen from the right with U at the top             (col 0 touches F)
 *   F: seen from the front with U at the top             (col 0 touches L)
 *   D: seen from below with F at the top of the view     (row 0 touches F, col 0 touches L)
 *   L: seen from the left with U at the top              (col 0 touches B)
 *   B: seen from behind with U at the top                (col 0 touches R)
 *
 * The value of a facelet is a colour id 0..5. Colour ids are arbitrary labels: no code may assume a
 * particular colour sits on a particular face, because a 6x6x6 has no fixed centres.
 */
export const N = 6;
export const NN = N * N;
export const NF = 6 * NN;

export const U = 0;
export const R = 1;
export const F = 2;
export const D = 3;
export const L = 4;
export const B = 5;
export type FaceId = 0 | 1 | 2 | 3 | 4 | 5;
export const FACE_LETTERS = 'URFDLB';
export const FACE_NAMES = ['top', 'right', 'front', 'bottom', 'left', 'back'] as const;

export type Vec3 = [number, number, number];

/** Outward unit normal of each face. */
export const FACE_NORMALS: readonly Vec3[] = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
  [0, -1, 0],
  [-1, 0, 0],
  [0, 0, -1],
];

export function faceletIndex(face: number, row: number, col: number): number {
  return face * NN + row * N + col;
}

export function faceletFace(index: number): FaceId {
  return Math.floor(index / NN) as FaceId;
}

export function faceletRow(index: number): number {
  return Math.floor((index % NN) / N);
}

export function faceletCol(index: number): number {
  return index % N;
}

/** Cubie coordinates (x, y, z) of the cubie that carries facelet (face, row, col). */
export function faceletCubie(face: number, row: number, col: number): Vec3 {
  const m = N - 1;
  switch (face) {
    case U:
      return [col, m, row];
    case R:
      return [m, m - row, m - col];
    case F:
      return [col, m - row, m];
    case D:
      return [col, 0, m - row];
    case L:
      return [0, m - row, col];
    case B:
      return [m - col, m - row, 0];
  }
  throw new Error('bad face ' + face);
}

/** Inverse of faceletCubie: the facelet index on the given face of the cubie at (x, y, z). */
export function cubieFaceletIndex(face: number, x: number, y: number, z: number): number {
  const m = N - 1;
  switch (face) {
    case U:
      return faceletIndex(U, z, x);
    case R:
      return faceletIndex(R, m - y, m - z);
    case F:
      return faceletIndex(F, m - y, x);
    case D:
      return faceletIndex(D, m - z, x);
    case L:
      return faceletIndex(L, m - y, z);
    case B:
      return faceletIndex(B, m - y, m - x);
  }
  throw new Error('bad face ' + face);
}

/** Face whose outward normal is the given axis-aligned unit vector. */
export function faceOfNormal(n: Vec3): FaceId {
  if (n[1] === 1) return U;
  if (n[0] === 1) return R;
  if (n[2] === 1) return F;
  if (n[1] === -1) return D;
  if (n[0] === -1) return L;
  if (n[2] === -1) return B;
  throw new Error('bad normal ' + n.join(','));
}

/** A solved cube in which face f carries colour f. */
export function solvedState(): Uint8Array {
  const s = new Uint8Array(NF);
  for (let i = 0; i < NF; i++) s[i] = Math.floor(i / NN);
  return s;
}

/** True when every face shows a single colour. */
export function isSolved(state: ArrayLike<number>): boolean {
  for (let f = 0; f < 6; f++) {
    const c = state[f * NN];
    for (let i = 1; i < NN; i++) if (state[f * NN + i] !== c) return false;
  }
  return true;
}
