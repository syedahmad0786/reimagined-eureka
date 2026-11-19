/**
 * Piece tables: which facelets belong to which corner, edge wing and centre piece.
 *
 * A 6x6x6 has 8 corners, 48 edge wings (two orbits of 24: outer wings next to the corners and inner
 * wings next to the middle of the edge) and 96 centre pieces (four orbits of 24: inner X, outer X and
 * two mirror-image oblique orbits).
 */
import { N, NF, U, R, F, D, L, B, FACE_NORMALS, cubieFaceletIndex, faceletIndex, type Vec3 } from './geometry';
import { movePerm, type Axis } from './moves';

export interface CornerSlot {
  name: string;
  /** Faces in clockwise order as seen from outside, starting with U or D. */
  faces: [number, number, number];
  facelets: [number, number, number];
}

const CORNER_FACES: [number, number, number][] = [
  [U, R, F],
  [U, F, L],
  [U, L, B],
  [U, B, R],
  [D, F, R],
  [D, L, F],
  [D, B, L],
  [D, R, B],
];

function cubieOnFaces(faces: number[], free?: { axis: number; t: number }): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const f of faces) {
    const n = FACE_NORMALS[f] as Vec3;
    for (let a = 0; a < 3; a++) if (n[a] !== 0) c[a] = n[a] === 1 ? N - 1 : 0;
  }
  if (free) c[free.axis] = free.t;
  return c;
}

/** Corners in the order URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB. */
export const CORNERS: CornerSlot[] = CORNER_FACES.map((faces) => {
  const c = cubieOnFaces(faces);
  return {
    name: faces.map((f) => 'URFDLB'[f]).join(''),
    faces,
    facelets: faces.map((f) => cubieFaceletIndex(f, c[0], c[1], c[2])) as [number, number, number],
  };
});

const EDGE_FACES: [number, number][] = [
  [U, R],
  [U, F],
  [U, L],
  [U, B],
  [D, R],
  [D, F],
  [D, L],
  [D, B],
  [F, R],
  [F, L],
  [B, L],
  [B, R],
];

export interface EdgeSlot {
  name: string;
  faces: [number, number];
  /** Axis the edge runs along. */
  axis: Axis;
}

/** Edges in the order UR, UF, UL, UB, DR, DF, DL, DB, FR, FL, BL, BR. */
export const EDGES: EdgeSlot[] = EDGE_FACES.map((faces) => {
  const used = [false, false, false];
  for (const f of faces) {
    const n = FACE_NORMALS[f] as Vec3;
    for (let a = 0; a < 3; a++) if (n[a] !== 0) used[a] = true;
  }
  return { name: faces.map((f) => 'URFDLB'[f]).join(''), faces, axis: used.indexOf(false) as Axis };
});

export interface WingSlot {
  /** Index into EDGES. */
  edge: number;
  /** Coordinate along the edge's axis, 1..4. */
  t: number;
  /** 0 for outer wings (t = 1 or 4), 1 for inner wings (t = 2 or 3). */
  orbit: 0 | 1;
  /** Facelets on EDGES[edge].faces[0] and faces[1], in that order. */
  facelets: [number, number];
  /**
   * The same two facelets in handed order. A wing cannot be flipped in place, so the ordered pair of
   * colours read through `handed` identifies the piece: the 24 wings of an orbit are exactly the 24
   * ordered pairs of adjacent colours.
   */
  handed: [number, number];
}

function det3(a: Vec3, b: Vec3, c: Vec3): number {
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
  );
}

/** Wing slots, index = edge * 4 + (t - 1). */
export const WINGS: WingSlot[] = [];
for (let e = 0; e < EDGES.length; e++) {
  const edge = EDGES[e] as EdgeSlot;
  for (let t = 1; t <= N - 2; t++) {
    const c = cubieOnFaces(edge.faces, { axis: edge.axis, t });
    const fa = cubieFaceletIndex(edge.faces[0], c[0], c[1], c[2]);
    const fb = cubieFaceletIndex(edge.faces[1], c[0], c[1], c[2]);
    const dir: Vec3 = [0, 0, 0];
    dir[edge.axis] = t < N / 2 ? -1 : 1;
    const positive = det3(FACE_NORMALS[edge.faces[0]] as Vec3, FACE_NORMALS[edge.faces[1]] as Vec3, dir) > 0;
    WINGS.push({
      edge: e,
      t,
      orbit: t === 1 || t === N - 2 ? 0 : 1,
      facelets: [fa, fb],
      handed: positive ? [fa, fb] : [fb, fa],
    });
  }
}

export const CENTRE_INNER_X = 0;
export const CENTRE_OUTER_X = 1;
export const CENTRE_OBLIQUE_A = 2;
export const CENTRE_OBLIQUE_B = 3;
export const CENTRE_ORBIT_NAMES = ['inner corner centres', 'outer corner centres', 'oblique centres (left-hand)', 'oblique centres (right-hand)'];

export interface CentreSlot {
  face: number;
  row: number;
  col: number;
  facelet: number;
  orbit: number;
}

/** Facelet orbits under all moves, as a label per facelet. Facelets with the same label can trade places. */
function faceletOrbits(): Int16Array {
  const parent = new Int16Array(NF);
  for (let i = 0; i < NF; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  for (let axis = 0 as Axis; axis < 3; axis++) {
    for (let layer = 0; layer < N; layer++) {
      const p = movePerm({ axis, lo: layer, hi: layer, q: 1 });
      for (let i = 0; i < NF; i++) {
        const a = find(i);
        const b = find(p[i] as number);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const out = new Int16Array(NF);
  for (let i = 0; i < NF; i++) out[i] = find(i);
  return out;
}

export const FACELET_ORBIT = faceletOrbits();

/** Centre slots, index = face * 16 + (row - 1) * 4 + (col - 1) for row, col in 1..4. */
export const CENTRES: CentreSlot[] = [];
{
  const labelA = FACELET_ORBIT[faceletIndex(U, 1, 2)];
  for (let face = 0; face < 6; face++) {
    for (let row = 1; row <= N - 2; row++) {
      for (let col = 1; col <= N - 2; col++) {
        const facelet = faceletIndex(face, row, col);
        const edgeRow = row === 1 || row === N - 2;
        const edgeCol = col === 1 || col === N - 2;
        let orbit: number;
        if (edgeRow && edgeCol) orbit = CENTRE_OUTER_X;
        else if (!edgeRow && !edgeCol) orbit = CENTRE_INNER_X;
        else orbit = FACELET_ORBIT[facelet] === labelA ? CENTRE_OBLIQUE_A : CENTRE_OBLIQUE_B;
        CENTRES.push({ face, row, col, facelet, orbit });
      }
    }
  }
}

export type FaceletKind = 'corner' | 'outer-wing' | 'inner-wing' | 'centre';

export function faceletKind(index: number): FaceletKind {
  const row = Math.floor((index % (N * N)) / N);
  const col = index % N;
  const er = row === 0 || row === N - 1;
  const ec = col === 0 || col === N - 1;
  if (er && ec) return 'corner';
  if (!er && !ec) return 'centre';
  const t = er ? col : row;
  return t === 1 || t === N - 2 ? 'outer-wing' : 'inner-wing';
}

/** Human-readable location of a facelet, for messages: "front face, row 2, column 5". */
export function describeFacelet(index: number): string {
  const names = ['top', 'right', 'front', 'bottom', 'left', 'back'];
  const face = Math.floor(index / (N * N));
  const row = Math.floor((index % (N * N)) / N);
  const col = index % N;
  return names[face] + ' face, row ' + (row + 1) + ', column ' + (col + 1);
}
