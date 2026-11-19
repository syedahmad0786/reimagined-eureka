/** Plane projective maps between the unit square and an image quad. */
import type { Point, Quad } from './types';

/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/**
 * Homography that maps the unit square to the quad: (0,0) -> top-left, (1,0) -> top-right,
 * (1,1) -> bottom-right, (0,1) -> bottom-left.
 */
export function squareToQuad(quad: Quad): Mat3 {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let h = 0;
  if (Math.abs(den) > 1e-12 && (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9)) {
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

export function applyMat3(m: Mat3, u: number, v: number): Point {
  const w = m[6] * u + m[7] * v + m[8];
  return { x: (m[0] * u + m[1] * v + m[2]) / w, y: (m[3] * u + m[4] * v + m[5]) / w };
}

export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const s = Math.abs(det) > 1e-18 ? 1 / det : 0;
  return [A * s, (c * h - b * i) * s, (b * f - c * e) * s, B * s, (a * i - c * g) * s, (c * d - a * f) * s, C * s, (b * g - a * h) * s, (a * e - b * d) * s];
}

/** Maps a point of the quad back to unit-square coordinates. */
export function quadToSquare(quad: Quad): Mat3 {
  return invertMat3(squareToQuad(quad));
}

export function quadArea(quad: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i] as Point;
    const q = quad[(i + 1) % 4] as Point;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** True when the quad is convex and wound clockwise on screen (y down), i.e. a usable face outline. */
export function isUsableQuad(quad: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = quad[i] as Point;
    const b = quad[(i + 1) % 4] as Point;
    const c = quad[(i + 2) % 4] as Point;
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return false;
  }
  return true;
}

export function centredSquareQuad(width: number, height: number, fraction = 0.7): Quad {
  const side = Math.min(width, height) * fraction;
  const x0 = (width - side) / 2;
  const y0 = (height - side) / 2;
  return [
    { x: x0, y: y0 },
    { x: x0 + side, y: y0 },
    { x: x0 + side, y: y0 + side },
    { x: x0, y: y0 + side },
  ];
}

export function cloneQuad(q: Quad): Quad {
  return [{ ...q[0] }, { ...q[1] }, { ...q[2] }, { ...q[3] }];
}
