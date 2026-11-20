/**
 * Corner shots: one photo that shows three faces of the cube around a corner.
 *
 * The outline is seven points (see CornerOutline in types.ts). sampleCornerShot returns the three
 * faces as [top, left, right], each oriented the way the faces U, F and R read in a view of the URF
 * corner with U on top:
 *
 *   top    row 0 is the far edge, col 0 is the side toward the left face  (like U seen from above with F at the bottom)
 *   left   row 0 touches the top face, col 5 touches the right face       (like F)
 *   right  row 0 touches the top face, col 0 touches the left face        (like R)
 */
import { FACE_NORMALS, N, NN, U, R, F, cubieFaceletIndex, faceOfNormal, faceletCubie, type Vec3 } from '../cube/geometry';
import { sampleFace } from './sample';
import type { CornerOutline, FaceSample, ImageLike, Point, Quad } from './types';

/** The three face quads of a corner outline, in the order top, left, right. */
export function cornerQuads(o: CornerOutline): [Quad, Quad, Quad] {
  const c = (p: Point): Point => ({ x: p.x, y: p.y });
  return [
    [c(o[1]), c(o[2]), c(o[0]), c(o[6])],
    [c(o[6]), c(o[0]), c(o[4]), c(o[5])],
    [c(o[0]), c(o[2]), c(o[3]), c(o[4])],
  ];
}

/** Samples the three visible faces of a corner shot: [top, left, right]. */
export function sampleCornerShot(image: ImageLike, outline: CornerOutline): [FaceSample, FaceSample, FaceSample] {
  const q = cornerQuads(outline);
  return [sampleFace(image, q[0]), sampleFace(image, q[1]), sampleFace(image, q[2])];
}

/** Which cube faces a corner shot shows, by position in the photo. */
export interface CornerView {
  top: number;
  left: number;
  right: number;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** True when the three faces meet at a corner and appear in this arrangement (top, left, right) in a real photo. */
export function isValidCornerView(view: CornerView): boolean {
  const t = FACE_NORMALS[view.top];
  const l = FACE_NORMALS[view.left];
  const r = FACE_NORMALS[view.right];
  if (!t || !l || !r) return false;
  // In the URF view: top = U (+y), left = F (+z), right = R (+x), and x cross y = z, so right x top = left.
  const c = cross(r as Vec3, t as Vec3);
  return c[0] === l[0] && c[1] === l[1] && c[2] === l[2];
}

/** All 24 ways three faces can appear in a corner shot. */
export function allCornerViews(): CornerView[] {
  const out: CornerView[] = [];
  for (let top = 0; top < 6; top++)
    for (let left = 0; left < 6; left++)
      for (let right = 0; right < 6; right++) {
        const v = { top, left, right };
        if (top !== left && top !== right && left !== right && isValidCornerView(v)) out.push(v);
      }
  return out;
}

/**
 * For a corner shot of the given faces, the facelet index (0..215, CONVENTIONS.md order) of every
 * sampled sticker: result[k * 36 + i] is where sticker i of sampled face k (0 top, 1 left, 2 right)
 * belongs in the cube state.
 */
export function cornerFaceletMap(view: CornerView): Uint8Array {
  if (!isValidCornerView(view)) throw new Error('not a corner view: ' + JSON.stringify(view));
  // Rotation that takes the reference frame (U top, F left, R right) to the photographed one.
  const ex = FACE_NORMALS[view.right] as Vec3; // image of +x (R)
  const ey = FACE_NORMALS[view.top] as Vec3; // image of +y (U)
  const ez = FACE_NORMALS[view.left] as Vec3; // image of +z (F)
  const rot = (v: Vec3): Vec3 => [
    ex[0] * v[0] + ey[0] * v[1] + ez[0] * v[2],
    ex[1] * v[0] + ey[1] * v[1] + ez[1] * v[2],
    ex[2] * v[0] + ey[2] * v[1] + ez[2] * v[2],
  ];
  const m = N - 1;
  const out = new Uint8Array(3 * NN);
  const ref = [U, F, R];
  for (let k = 0; k < 3; k++) {
    const face = ref[k] as number;
    const normal = rot(FACE_NORMALS[face] as Vec3);
    for (let row = 0; row < N; row++)
      for (let col = 0; col < N; col++) {
        const cubie = faceletCubie(face, row, col);
        const p = rot([2 * cubie[0] - m, 2 * cubie[1] - m, 2 * cubie[2] - m]);
        out[k * NN + row * N + col] = cubieFaceletIndex(faceOfNormal(normal), (p[0] + m) / 2, (p[1] + m) / 2, (p[2] + m) / 2);
      }
  }
  return out;
}

/** One corner shot: its three sampled faces and which cube faces they are. */
export interface CornerShot {
  view: CornerView;
  faces: readonly [FaceSample, FaceSample, FaceSample];
}

/**
 * Assembles six FaceSamples in U R F D L B order (each in the CONVENTIONS.md reading orientation) from
 * corner shots. Two shots of opposite corners cover the cube. A face seen in more than one shot takes
 * each sticker from the view with the higher quality. Faces nobody photographed come back as null.
 */
export function assembleCornerShots(shots: readonly CornerShot[]): (FaceSample | null)[] {
  const faces: (FaceSample | null)[] = [null, null, null, null, null, null];
  for (const shot of shots) {
    const map = cornerFaceletMap(shot.view);
    for (let k = 0; k < 3; k++) {
      const src = shot.faces[k] as FaceSample;
      for (let i = 0; i < NN; i++) {
        const target = map[k * NN + i] as number;
        const face = Math.floor(target / NN);
        const j = target % NN;
        let dst = faces[face];
        if (!dst) {
          dst = { rgb: new Float32Array(NN * 3), lab: new Float32Array(NN * 3), quality: new Float32Array(NN).fill(-1) };
          faces[face] = dst;
        }
        if ((src.quality[i] as number) > (dst.quality[j] as number)) {
          for (let c = 0; c < 3; c++) {
            dst.rgb[j * 3 + c] = src.rgb[i * 3 + c] as number;
            dst.lab[j * 3 + c] = src.lab[i * 3 + c] as number;
          }
          dst.quality[j] = src.quality[i] as number;
        }
      }
    }
  }
  for (const f of faces) if (f) for (let i = 0; i < NN; i++) if ((f.quality[i] as number) < 0) f.quality[i] = 0;
  return faces;
}

/** One face of a corner shot as a cube face. */
export interface CornerFace {
  /** Cube face id 0..5 (U R F D L B). */
  face: number;
  /** The face outline in the photo, turned so that sampleFace(image, quad) reads the face in CONVENTIONS.md order. */
  quad: Quad;
  /** Which sampled face of the shot this is: 0 top, 1 left, 2 right. */
  from: number;
  /** order[i] is the cell of the sampled face (in the outline's own order) that is cell i of the cube face. */
  order: number[];
}

/** The three faces of a corner shot as cube faces for the given view, with their quads in reading order. */
export function cornerFaceQuads(outline: CornerOutline, view: CornerView): CornerFace[] {
  const quads = cornerQuads(outline);
  const map = cornerFaceletMap(view);
  const cornerOf = (i: number): number => (i === 0 ? 0 : i === 5 ? 1 : i === 35 ? 2 : 3);
  return [0, 1, 2].map((k) => {
    const order = new Array<number>(NN);
    for (let i = 0; i < NN; i++) order[(map[k * NN + i] as number) % NN] = i;
    const q = quads[k] as Quad;
    const quad = [0, 5, 35, 30].map((target) => q[cornerOf(order[target] as number)]) as Quad;
    return { face: Math.floor((map[k * NN] as number) / NN), quad, from: k, order };
  });
}

/**
 * The three faces of a corner shot as straight-on "photos": cube face, quad in reading order and the
 * sticker samples in reading order. With samples (the camera's merged samples, in the order top, left,
 * right) those are re-indexed; without, each face is sampled from the image.
 */
export function cornerFaces(image: ImageLike, outline: CornerOutline, view: CornerView, samples?: readonly FaceSample[]): { face: number; quad: Quad; sample: FaceSample }[] {
  return cornerFaceQuads(outline, view).map((f) => {
    const src = samples && samples.length === 3 ? samples[f.from] : undefined;
    if (!src) return { face: f.face, quad: f.quad, sample: sampleFace(image, f.quad) };
    const sample: FaceSample = { rgb: new Float32Array(NN * 3), lab: new Float32Array(NN * 3), quality: new Float32Array(NN) };
    for (let i = 0; i < NN; i++) {
      const j = f.order[i] as number;
      for (let c = 0; c < 3; c++) {
        sample.rgb[i * 3 + c] = src.rgb[j * 3 + c] as number;
        sample.lab[i * 3 + c] = src.lab[j * 3 + c] as number;
      }
      sample.quality[i] = src.quality[j] as number;
    }
    return { face: f.face, quad: f.quad, sample };
  });
}

/** The two-photo flow the app can offer: first the URF corner with U on top, then the opposite corner with D on top. */
export const TWO_SHOT_VIEWS: readonly [CornerView, CornerView] = [
  { top: 0, left: 2, right: 1 },
  { top: 3, left: 4, right: 5 },
];
