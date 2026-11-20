/**
 * Best-effort starting guesses for the face outline of an uploaded photo. Both functions search for
 * the placement of a 6x6 grid (or of the three grids of a corner view) whose lines sit on edges of the
 * photo while the sticker interiors stay flat, coarse first, then refined. They never throw: when
 * nothing convincing is found they return a centred default with confidence 0.
 */
import { cornerQuads } from './corner';
import { applyMat3, centredSquareQuad, squareToQuad } from './homography';
import { buildEdgeMap, downscaleRgb, gridScore, refinePoints, CORNER_OUTSIDE, OUTSIDE_ALL, type EdgeMap } from './refine';
import type { CornerOutline, ImageLike, Point, Quad } from './types';

interface Candidate<T> {
  score: number;
  cx: number;
  cy: number;
  size: number;
  shape: T;
}

function keepBest<T>(list: Candidate<T>[], c: Candidate<T>, limit: number): void {
  // Non-maximum suppression: one candidate per neighbourhood.
  for (let i = 0; i < list.length; i++) {
    const o = list[i] as Candidate<T>;
    if (Math.hypot(o.cx - c.cx, o.cy - c.cy) < 0.2 * Math.max(o.size, c.size) && Math.abs(Math.log(o.size / c.size)) < 0.25) {
      if (c.score > o.score) list[i] = c;
      return;
    }
  }
  if (list.length < limit) {
    list.push(c);
    return;
  }
  let worst = 0;
  for (let i = 1; i < list.length; i++) if ((list[i] as Candidate<T>).score < (list[worst] as Candidate<T>).score) worst = i;
  if (c.score > (list[worst] as Candidate<T>).score) list[worst] = c;
}

function edgeMaps(image: ImageLike, coarseShort: number, fineShort: number): { coarse: EdgeMap; fine: EdgeMap } {
  const long = Math.max(image.width, image.height);
  const short = Math.max(1, Math.min(image.width, image.height));
  const ratio = long / short;
  return {
    coarse: buildEdgeMap(image, Math.min(640, Math.round(coarseShort * ratio)), [2, 1]),
    fine: buildEdgeMap(image, Math.min(1400, Math.round(fineShort * ratio)), [4, 2, 1, 0]),
  };
}

/**
 * Convex hull (image pixels, clockwise on screen) of the biggest blob of strongly coloured pixels that
 * is not mostly on the image border: on a plain table that blob is the cube. Null when there is no
 * such blob or when it fills the picture (a colourful background).
 */
export function colourfulHull(image: ImageLike): Point[] | null {
  return blobHull(image, 'colourful');
}

/**
 * The same for the biggest blob of pixels whose colour does not occur along the image border: on a
 * wooden or otherwise coloured table the border shows the table, and the cube is what differs from it.
 */
export function foregroundHull(image: ImageLike): Point[] | null {
  return blobHull(image, 'foreground');
}

function blobHull(image: ImageLike, kind: 'colourful' | 'foreground'): Point[] | null {
  const short = Math.max(1, Math.min(image.width, image.height));
  const small = downscaleRgb(image, Math.round((150 * Math.max(image.width, image.height)) / short));
  const w = small.width;
  const h = small.height;
  let mask: Uint8Array = new Uint8Array(w * h);
  if (kind === 'colourful') {
    for (let i = 0; i < w * h; i++) {
      const r = small.rgb[i * 3] as number;
      const g = small.rgb[i * 3 + 1] as number;
      const b = small.rgb[i * 3 + 2] as number;
      const mx = Math.max(r, g, b);
      const chroma = mx - Math.min(r, g, b);
      mask[i] = mx >= 70 && chroma >= 0.38 * mx && chroma >= 55 ? 1 : 0;
    }
  } else {
    // Colours of the border band, in coarse bins; a pixel is background when its bin or a neighbouring bin is common there.
    const Q = 12;
    const bin = (i: number) => {
      const r = Math.min(Q - 1, Math.floor(((small.rgb[i * 3] as number) * Q) / 256));
      const g = Math.min(Q - 1, Math.floor(((small.rgb[i * 3 + 1] as number) * Q) / 256));
      const b = Math.min(Q - 1, Math.floor(((small.rgb[i * 3 + 2] as number) * Q) / 256));
      return (r * Q + g) * Q + b;
    };
    const hist = new Float32Array(Q * Q * Q);
    const band = Math.max(2, Math.round(0.07 * Math.min(w, h)));
    let ring = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (x >= band && x < w - band && y >= band && y < h - band) continue;
        hist[bin(y * w + x)] += 1;
        ring++;
      }
    const background = new Uint8Array(Q * Q * Q);
    for (let r = 0; r < Q; r++)
      for (let g = 0; g < Q; g++)
        for (let b = 0; b < Q; b++) {
          if ((hist[(r * Q + g) * Q + b] as number) < 0.003 * ring) continue;
          for (let dr = -1; dr <= 1; dr++)
            for (let dg = -1; dg <= 1; dg++)
              for (let db = -1; db <= 1; db++) {
                const rr = r + dr;
                const gg = g + dg;
                const bb = b + db;
                if (rr >= 0 && gg >= 0 && bb >= 0 && rr < Q && gg < Q && bb < Q) background[(rr * Q + gg) * Q + bb] = 1;
              }
        }
    for (let i = 0; i < w * h; i++) mask[i] = background[bin(i)] ? 0 : 1;
  }
  const morph = (src: Uint8Array, radius: number, grow: boolean): Uint8Array => {
    const tmp = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let d = -radius; d <= radius; d++) {
          const xx = x + d;
          const s = xx < 0 || xx >= w ? (grow ? 0 : 1) : (src[y * w + xx] as number);
          v = grow ? v | s : v & s;
        }
        tmp[y * w + x] = v;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let d = -radius; d <= radius; d++) {
          const yy = y + d;
          const s = yy < 0 || yy >= h ? (grow ? 0 : 1) : (tmp[yy * w + x] as number);
          v = grow ? v | s : v & s;
        }
        out[y * w + x] = v;
      }
    return out;
  };
  mask = morph(morph(mask, 3, true), 3, false);
  const label = new Int32Array(w * h);
  let bestScore = 0;
  let bestLabel = 0;
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let area = 0;
    let border = 0;
    stack.push(start);
    label[start] = next;
    while (stack.length) {
      const i = stack.pop() as number;
      area++;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border++;
      if (x > 0 && mask[i - 1] && !label[i - 1]) (label[i - 1] = next), stack.push(i - 1);
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) (label[i + 1] = next), stack.push(i + 1);
      if (y > 0 && mask[i - w] && !label[i - w]) (label[i - w] = next), stack.push(i - w);
      if (y < h - 1 && mask[i + w] && !label[i + w]) (label[i + w] = next), stack.push(i + w);
    }
    const score = area * Math.max(0.05, 1 - (4 * border) / Math.sqrt(area + 1));
    if (score > bestScore) {
      bestScore = score;
      bestLabel = next;
    }
  }
  if (!bestLabel) return null;
  const pts: Point[] = [];
  let area = 0;
  for (let y = 0; y < h; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < w; x++)
      if (label[y * w + x] === bestLabel) {
        if (first < 0) first = x;
        last = x;
        area++;
      }
    if (first >= 0) pts.push({ x: first, y }, { x: last + 1, y }, { x: first, y: y + 1 }, { x: last + 1, y: y + 1 });
  }
  if (area < 0.015 * w * h || area > 0.75 * w * h) return null;
  // Monotone chain convex hull.
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Point, lower[lower.length - 1] as Point, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i] as Point;
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Point, upper[upper.length - 1] as Point, p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  // lower then upper with y down runs clockwise on screen.
  return hull.map((p) => ({ x: p.x / small.scale, y: p.y / small.scale }));
}

/** Shrinks a convex polygon to k sides by repeatedly replacing its cheapest side with the meeting point of the two sides next to it. */
export function circumscribe(hull: readonly Point[], k: number): Point[] | null {
  const poly = hull.map((p) => ({ x: p.x, y: p.y }));
  while (poly.length > k) {
    const n = poly.length;
    let best = -1;
    let bestArea = Infinity;
    let bestPoint: Point | null = null;
    for (let i = 0; i < n; i++) {
      const a = poly[(i + n - 1) % n] as Point;
      const b = poly[i] as Point;
      const c = poly[(i + 1) % n] as Point;
      const d = poly[(i + 2) % n] as Point;
      const r1x = b.x - a.x;
      const r1y = b.y - a.y;
      const r2x = c.x - d.x;
      const r2y = c.y - d.y;
      const den = r1x * r2y - r1y * r2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((d.x - a.x) * r2y - (d.y - a.y) * r2x) / den;
      const u = ((d.x - a.x) * r1y - (d.y - a.y) * r1x) / den;
      if (t < 1 || u < 1) continue; // the neighbours meet on the wrong side
      const x = { x: a.x + t * r1x, y: a.y + t * r1y };
      const added = Math.abs((b.x - x.x) * (c.y - x.y) - (b.y - x.y) * (c.x - x.x)) / 2;
      if (added < bestArea) {
        bestArea = added;
        best = i;
        bestPoint = x;
      }
    }
    if (best < 0 || !bestPoint) return null;
    const j = (best + 1) % n;
    poly[best] = bestPoint;
    poly.splice(j, 1);
  }
  return poly.length === k ? poly : null;
}

/** Where the three inner edges of a corner view meet, from the six silhouette vertices (clockwise from the back), using the vanishing points. */
export function nearCornerFromHexagon(h: readonly Point[]): Point {
  type V = [number, number, number];
  const hp = (p: Point): V => [p.x, p.y, 1];
  const cr = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const line = (a: Point, b: Point) => cr(hp(a), hp(b));
  const [o1, o2, o3, o4, o5, o6] = h as [Point, Point, Point, Point, Point, Point];
  const vx = cr(line(o1, o2), line(o5, o4));
  const vz = cr(line(o1, o6), line(o3, o4));
  const vy = cr(line(o2, o3), line(o6, o5));
  const lines = [cr(hp(o6), vx), cr(hp(o2), vz), cr(hp(o4), vy)];
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < 3; i++) {
    const x = cr(lines[i] as V, lines[(i + 1) % 3] as V);
    if (Math.abs(x[2]) > 1e-9) {
      sx += x[0] / x[2];
      sy += x[1] / x[2];
      n++;
    }
  }
  if (!n) return { x: (o2.x + o4.x + o6.x) / 3, y: (o2.y + o4.y + o6.y) / 3 };
  return { x: sx / n, y: sy / n };
}

/**
 * Where far corner `which` (1 back, 3 right, 5 left) of a corner outline must be, given the other six
 * points, because the nine visible cube edges meet in three vanishing points.
 */
export function predictFarCorner(o: readonly Point[], which: 1 | 3 | 5): Point | null {
  type V = [number, number, number];
  const hp = (p: Point): V => [p.x, p.y, 1];
  const cr = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const line = (a: Point, b: Point) => cr(hp(a), hp(b));
  const [c, o1, o2, o3, o4, o5, o6] = o as [Point, Point, Point, Point, Point, Point, Point];
  let x: V;
  if (which === 5) {
    const vx = cr(line(o1, o2), line(o6, c));
    const vy = cr(line(o2, o3), line(c, o4));
    x = cr(cr(hp(o6), vy), cr(hp(o4), vx));
  } else if (which === 3) {
    const vy = cr(line(c, o4), line(o6, o5));
    const vz = cr(line(o2, c), line(o1, o6));
    x = cr(cr(hp(o2), vy), cr(hp(o4), vz));
  } else {
    const vx = cr(line(o6, c), line(o5, o4));
    const vz = cr(line(o2, c), line(o3, o4));
    x = cr(cr(hp(o2), vx), cr(hp(o6), vz));
  }
  if (Math.abs(x[2]) < 1e-9) return null;
  const p = { x: x[0] / x[2], y: x[1] / x[2] };
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

/** Cube vertices of the seven outline points, in units of half a cube side (x toward the right face, y up, z toward the left face). */
const OUTLINE_VERTICES = [
  [1, 1, 1],
  [-1, 1, -1],
  [1, 1, -1],
  [1, -1, -1],
  [1, -1, 1],
  [-1, -1, 1],
  [-1, 1, 1],
];

/**
 * The projective camera that best maps the seven cube vertices onto the outline points (direct linear
 * transform). Returns a function from cube coordinates to image points, or null when the points are degenerate.
 */
export function fitCubeCamera(outline: readonly Point[]): ((x: number, y: number, z: number) => Point) | null {
  // Unknowns p0..p10 with p11 = 1:  u = (p0 X + p1 Y + p2 Z + p3) / (p8 X + p9 Y + p10 Z + 1), same for v with p4..p7.
  const n = 11;
  const ata = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  const addRow = (row: number[], rhs: number) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) (ata[i] as number[])[j] = ((ata[i] as number[])[j] as number) + (row[i] as number) * (row[j] as number);
      (ata[i] as number[])[n] = ((ata[i] as number[])[n] as number) + (row[i] as number) * rhs;
    }
  };
  for (let k = 0; k < 7; k++) {
    const [X, Y, Z] = OUTLINE_VERTICES[k] as [number, number, number];
    const { x: u, y: v } = outline[k] as Point;
    addRow([X, Y, Z, 1, 0, 0, 0, 0, -u * X, -u * Y, -u * Z], u);
    addRow([0, 0, 0, 0, X, Y, Z, 1, -v * X, -v * Y, -v * Z], v);
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs((ata[r] as number[])[c] as number) > Math.abs((ata[p] as number[])[c] as number)) p = r;
    [ata[c], ata[p]] = [ata[p] as number[], ata[c] as number[]];
    const piv = (ata[c] as number[])[c] as number;
    if (Math.abs(piv) < 1e-10) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = ((ata[r] as number[])[c] as number) / piv;
      if (f === 0) continue;
      for (let j = c; j <= n; j++) (ata[r] as number[])[j] = ((ata[r] as number[])[j] as number) - f * ((ata[c] as number[])[j] as number);
    }
  }
  const p = ata.map((row, i) => (row[n] as number) / (row[i] as number));
  if (p.some((v) => !Number.isFinite(v))) return null;
  return (X, Y, Z) => {
    const w = (p[8] as number) * X + (p[9] as number) * Y + (p[10] as number) * Z + 1;
    return { x: ((p[0] as number) * X + (p[1] as number) * Y + (p[2] as number) * Z + (p[3] as number)) / w, y: ((p[4] as number) * X + (p[5] as number) * Y + (p[6] as number) * Z + (p[7] as number)) / w };
  };
}

function squareQuad(cx: number, cy: number, size: number, rot: number): Quad {
  const c = (Math.cos(rot) * size) / 2;
  const s = (Math.sin(rot) * size) / 2;
  return [
    { x: cx - c + s, y: cy - s - c },
    { x: cx + c + s, y: cy + s - c },
    { x: cx + c - s, y: cy + s + c },
    { x: cx - c - s, y: cy - s + c },
  ];
}

const confidenceOf = (score: number): number => Math.max(0, Math.min(1, (score - 0.12) / 0.2));

/** Outline of the 6x6 sticker area of a face photographed roughly straight on. */
export function detectFaceQuad(image: ImageLike): { quad: Quad; confidence: number } {
  const fallback = { quad: centredSquareQuad(image.width, image.height), confidence: 0 };
  try {
    if (!(image.width >= 24 && image.height >= 24)) return fallback;
    const { coarse, fine } = edgeMaps(image, 190, 440);
    const short = Math.min(image.width, image.height);
    const best: Candidate<Quad>[] = [];
    const hull = colourfulHull(image) || foregroundHull(image);
    let bx0 = 0;
    let by0 = 0;
    let bx1 = image.width;
    let by1 = image.height;
    let minSize = 0.26 * short;
    let maxSize = short;
    if (hull) {
      const xs = hull.map((p) => p.x);
      const ys = hull.map((p) => p.y);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const pad = 0.12 * span;
      bx0 = Math.max(0, Math.min(...xs) - pad);
      by0 = Math.max(0, Math.min(...ys) - pad);
      bx1 = Math.min(image.width, Math.max(...xs) + pad);
      by1 = Math.min(image.height, Math.max(...ys) + pad);
      minSize = Math.max(minSize, 0.5 * span);
      maxSize = Math.min(maxSize, 1.15 * span);
      const quad = circumscribe(hull, 4);
      if (quad) {
        let first = 0;
        for (let i = 1; i < 4; i++) if ((quad[i] as Point).x + (quad[i] as Point).y < (quad[first] as Point).x + (quad[first] as Point).y) first = i;
        const q = [0, 1, 2, 3].map((i) => quad[(first + i) % 4] as Point) as Quad;
        best.push({ score: 1, cx: -1e9, cy: -1e9, size: span, shape: q });
      }
    }
    for (let size = minSize; size <= maxSize; size *= 1.08) {
      const step = size / 12;
      for (const deg of [-16, -8, 0, 8, 16]) {
        const rot = (deg * Math.PI) / 180;
        const ext = (size / 2) * (Math.abs(Math.cos(rot)) + Math.abs(Math.sin(rot)));
        const x0 = Math.min(bx0 + ext, (bx0 + bx1) / 2);
        const x1 = Math.max(bx1 - ext, (bx0 + bx1) / 2);
        const y0 = Math.min(by0 + ext, (by0 + by1) / 2);
        const y1 = Math.max(by1 - ext, (by0 + by1) / 2);
        for (let cy = y0; cy <= y1 + 1e-6; cy += step)
          for (let cx = x0; cx <= x1 + 1e-6; cx += step) {
            const quad = squareQuad(cx, cy, size, rot);
            keepBest(best, { score: gridScore(coarse, 0, quad, 12, 1, OUTSIDE_ALL), cx, cy, size, shape: quad }, 9);
          }
      }
    }
    let top: { quad: Quad; score: number } | null = null;
    for (const c of best) {
      const r = refinePoints(fine, c.shape, (p) => [[p[0] as Point, p[1] as Point, p[2] as Point, p[3] as Point]], c.size / 14, [OUTSIDE_ALL], 0, 20);
      if (!top || r.score > top.score) top = { quad: r.points as Quad, score: r.score };
    }
    if (!top || !Number.isFinite(top.score) || top.score <= 0) return fallback;
    // The coarse search cannot tell a grid from the same grid one sticker over, so test those directly.
    for (let round = 0; round < 3; round++) {
      const h = squareToQuad(top.quad);
      let better: { quad: Quad; score: number } | null = null;
      for (let dv = -1; dv <= 1; dv++)
        for (let du = -1; du <= 1; du++) {
          if (!du && !dv) continue;
          const shifted = [applyMat3(h, du / 6, dv / 6), applyMat3(h, 1 + du / 6, dv / 6), applyMat3(h, 1 + du / 6, 1 + dv / 6), applyMat3(h, du / 6, 1 + dv / 6)];
          const side = Math.hypot((shifted[1] as Point).x - (shifted[0] as Point).x, (shifted[1] as Point).y - (shifted[0] as Point).y);
          const r = refinePoints(fine, shifted, (p) => [[p[0] as Point, p[1] as Point, p[2] as Point, p[3] as Point]], side / 40, [OUTSIDE_ALL], 1, 20);
          if (r.score > top.score && (!better || r.score > better.score)) better = { quad: r.points as Quad, score: r.score };
        }
      if (!better) break;
      top = better;
    }
    return { quad: top.quad, confidence: confidenceOf(top.score) };
  } catch {
    return fallback;
  }
}

/**
 * The seven outline points of a cube seen from elevation el and swing sw (radians) at distance dist
 * (in half cube sides), scaled so the silhouette is 1 wide and centred on its bounding box.
 */
export function projectCornerView(el: number, sw: number, roll: number, dist: number): Point[] {
  const a = Math.PI / 4 + sw;
  const eye = [dist * Math.cos(el) * Math.sin(a), dist * Math.sin(el), dist * Math.cos(el) * Math.cos(a)];
  const n = Math.hypot(eye[0] as number, eye[1] as number, eye[2] as number);
  const f = [-(eye[0] as number) / n, -(eye[1] as number) / n, -(eye[2] as number) / n];
  const rl = Math.hypot(f[2] as number, f[0] as number);
  const right = [-(f[2] as number) / rl, 0, (f[0] as number) / rl];
  const up = [
    (right[1] as number) * (f[2] as number) - (right[2] as number) * (f[1] as number),
    (right[2] as number) * (f[0] as number) - (right[0] as number) * (f[2] as number),
    (right[0] as number) * (f[1] as number) - (right[1] as number) * (f[0] as number),
  ];
  const corners = [
    [1, 1, 1],
    [-1, 1, -1],
    [1, 1, -1],
    [1, -1, -1],
    [1, -1, 1],
    [-1, -1, 1],
    [-1, 1, 1],
  ];
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const pts = corners.map((c) => {
    const v = [(c[0] as number) - (eye[0] as number), (c[1] as number) - (eye[1] as number), (c[2] as number) - (eye[2] as number)];
    const z = (v[0] as number) * (f[0] as number) + (v[1] as number) * (f[1] as number) + (v[2] as number) * (f[2] as number);
    const x = ((v[0] as number) * (right[0] as number) + (v[1] as number) * (right[1] as number) + (v[2] as number) * (right[2] as number)) / z;
    const y = -((v[0] as number) * (up[0] as number) + (v[1] as number) * (up[1] as number) + (v[2] as number) * (up[2] as number)) / z;
    return { x: x * cr - y * sr, y: x * sr + y * cr };
  });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const mx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const my = (Math.max(...ys) + Math.min(...ys)) / 2;
  return pts.map((p) => ({ x: (p.x - mx) / w, y: (p.y - my) / w }));
}

function outlineScore(edge: EdgeMap, level: number, outline: readonly Point[], lineSamples: number, cellSamples: number): number {
  let s = 0;
  const quads = cornerQuads(outline as CornerOutline);
  for (let i = 0; i < 3; i++) {
    const v = gridScore(edge, level, quads[i] as Quad, lineSamples, cellSamples, CORNER_OUTSIDE[i]);
    if (v <= -1) return -1;
    s += v;
  }
  return s / 3;
}

function defaultOutline(image: ImageLike): CornerOutline {
  const size = Math.min(image.width, image.height) * 0.7;
  return projectCornerView(0.7, 0, 0, 7).map((p) => ({ x: image.width / 2 + p.x * size, y: image.height / 2 + p.y * size })) as CornerOutline;
}

/** Outline of a cube photographed corner-on (three faces visible, one of them on top). */
export function detectCornerOutline(image: ImageLike): { outline: CornerOutline; confidence: number } {
  const fallback = { outline: defaultOutline(image), confidence: 0 };
  try {
    if (!(image.width >= 24 && image.height >= 24)) return fallback;
    const { coarse, fine } = edgeMaps(image, 210, 460);
    const short = Math.min(image.width, image.height);
    const d2r = Math.PI / 180;
    const place = (shape: Point[], cx: number, cy: number, size: number): Point[] => shape.map((p) => ({ x: cx + p.x * size, y: cy + p.y * size }));
    // Stage 1: where and how big, with a few typical poses.
    const located: Candidate<Point[]>[] = [];
    const direct: Point[][] = [];
    const hulls = [colourfulHull(image), foregroundHull(image)].filter(Boolean) as Point[][];
    for (const hull of hulls) {
      const hex = circumscribe(hull, 6);
      if (!hex) continue;
      // Start the outline at the topmost vertex: in an upright corner shot that is the back corner.
      let first = 0;
      for (let i = 1; i < 6; i++) if ((hex[i] as Point).y < (hex[first] as Point).y) first = i;
      const ring = [0, 1, 2, 3, 4, 5].map((i) => hex[(first + i) % 6] as Point);
      direct.push([nearCornerFromHexagon(ring), ...ring]);
      const xs = hull.map((p) => p.x);
      const ys = hull.map((p) => p.y);
      const size = Math.max(...xs) - Math.min(...xs);
      located.push({ score: 1, cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, size, shape: [] });
    }
    const poses = [28, 38, 48].map((el) => projectCornerView(el * d2r, 0, 0, 7));
    for (let size = located.length ? Infinity : 0.36 * short; size <= 1.0 * short; size *= 1.1) {
      const step = size / 13;
      for (const shape of poses) {
        const ys = shape.map((p) => p.y);
        const top = -Math.min(...ys) * size;
        const bottom = Math.max(...ys) * size;
        const x0 = Math.min(size / 2, image.width / 2);
        const x1 = Math.max(image.width - size / 2, image.width / 2);
        const y0 = Math.min(top, image.height / 2);
        const y1 = Math.max(image.height - bottom, image.height / 2);
        for (let cy = y0; cy <= y1 + 1e-6; cy += step)
          for (let cx = x0; cx <= x1 + 1e-6; cx += step) keepBest(located, { score: outlineScore(coarse, 0, place(shape, cx, cy, size), 8, 1), cx, cy, size, shape }, 6);
      }
    }
    // Stage 2: pose, size and position around each location, by coordinate ascent.
    const posed: Candidate<Point[]>[] = [];
    for (const loc of located) {
      // el, swing, roll (degrees), distance, log size, x, y (in units of the size)
      const theta = [38, 0, 0, 7, 0, 0, 0];
      const steps = [8, 8, 6, 1.5, 0.08, 0.05, 0.05];
      const lo = [15, -25, -20, 4, -0.5, -0.6, -0.6];
      const hi = [65, 25, 20, 12, 0.5, 0.6, 0.6];
      const build = (t: number[]): Point[] =>
        place(projectCornerView((t[0] as number) * d2r, (t[1] as number) * d2r, (t[2] as number) * d2r, t[3] as number), loc.cx + (t[5] as number) * loc.size, loc.cy + (t[6] as number) * loc.size, loc.size * Math.exp(t[4] as number));
      let bestScore = outlineScore(coarse, 1, build(theta), 10, 1);
      for (let round = 0; round < 4; round++) {
        let improved = true;
        let guard = 0;
        while (improved && guard++ < 12) {
          improved = false;
          for (let i = 0; i < theta.length; i++)
            for (const dir of [-1, 1]) {
              const old = theta[i] as number;
              const next = Math.max(lo[i] as number, Math.min(hi[i] as number, old + dir * (steps[i] as number)));
              if (next === old) continue;
              theta[i] = next;
              const sc = outlineScore(coarse, 1, build(theta), 10, 1);
              if (sc > bestScore + 1e-6) {
                bestScore = sc;
                improved = true;
              } else theta[i] = old;
            }
        }
        for (let i = 0; i < steps.length; i++) steps[i] = (steps[i] as number) / 2;
      }
      posed.push({ score: bestScore, cx: loc.cx, cy: loc.cy, size: loc.size * Math.exp(theta[4] as number), shape: build(theta) });
    }
    posed.sort((a, b) => b.score - a.score);
    // Stage 3: free refinement of the seven points.
    let top: { outline: CornerOutline; score: number } | null = null;
    const starts = direct.map((shape) => ({ shape, size: short / 2 })).concat(posed.slice(0, 3));
    for (const c of starts) {
      const r = refinePoints(fine, c.shape, (p) => cornerQuads(p as CornerOutline), c.size / 30, CORNER_OUTSIDE, 0, 20);
      if (!top || r.score > top.score) top = { outline: r.points as CornerOutline, score: r.score };
    }
    if (!top || !Number.isFinite(top.score) || top.score <= 0) return fallback;
    // A far corner hidden by a white sticker on white paper leaves one point stranded: test each far
    // corner against where the other six points say it must be.
    for (const which of [1, 3, 5] as const) {
      const p = predictFarCorner(top.outline, which);
      if (!p || Math.hypot(p.x - top.outline[which].x, p.y - top.outline[which].y) < short / 60) continue;
      const alt = top.outline.map((q, i) => (i === which ? p : q));
      const r = refinePoints(fine, alt, (pts) => cornerQuads(pts as CornerOutline), short / 80, CORNER_OUTSIDE, 1, 20);
      if (r.score > top.score) top = { outline: r.points as CornerOutline, score: r.score };
    }
    // And test the same outline moved by one sticker along each cube edge direction.
    for (let round = 0; round < 4; round++) {
      const camera = fitCubeCamera(top.outline);
      if (!camera) break;
      let better: { outline: CornerOutline; score: number } | null = null;
      for (let axis = 0; axis < 3; axis++)
        for (const dir of [-1, 1]) {
          const shifted = OUTLINE_VERTICES.map((v) => {
            const q = [v[0] as number, v[1] as number, v[2] as number];
            q[axis] = (q[axis] as number) + dir / 3;
            return camera(q[0] as number, q[1] as number, q[2] as number);
          });
          const r = refinePoints(fine, shifted, (pts) => cornerQuads(pts as CornerOutline), short / 100, CORNER_OUTSIDE, 1, 20);
          if (r.score > top.score && (!better || r.score > better.score)) better = { outline: r.points as CornerOutline, score: r.score };
        }
      if (!better) break;
      top = better;
    }
    return { outline: top.outline, confidence: confidenceOf(top.score) };
  } catch {
    return fallback;
  }
}
