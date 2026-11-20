/**
 * Snaps a roughly placed 6x6 grid (or three of them, for a corner shot) onto the sticker boundaries
 * of the photo: the grid lines should run along edges (gaps between cubies, sticker borders) and the
 * sticker interiors should be flat.
 */
import { isUsableQuad, squareToQuad } from './homography';
import type { ImageLike, Point, Quad } from './types';

export interface EdgeMap {
  width: number;
  height: number;
  /** Map pixels per image pixel. */
  scale: number;
  /** Edge strength 0..1 at several blur levels, coarsest first. */
  levels: Float32Array[];
}

function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -radius; x <= radius; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))] as number;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += (src[row + Math.min(w - 1, x + radius + 1)] as number) - (src[row + Math.max(0, x - radius)] as number);
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x] as number;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += (tmp[Math.min(h - 1, y + radius + 1) * w + x] as number) - (tmp[Math.max(0, y - radius) * w + x] as number);
    }
  }
  return out;
}

/** Area-averaged downscale of the RGB channels to at most maxSide on the long side. */
export function downscaleRgb(image: ImageLike, maxSide: number): { width: number; height: number; scale: number; rgb: Float32Array } {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const rgb = new Float32Array(w * h * 3);
  const count = new Float32Array(w * h);
  const d = image.data;
  const xmap = new Int32Array(image.width);
  for (let x = 0; x < image.width; x++) xmap[x] = Math.min(w - 1, Math.floor(((x + 0.5) * w) / image.width));
  for (let y = 0; y < image.height; y++) {
    const ty = Math.min(h - 1, Math.floor(((y + 0.5) * h) / image.height));
    for (let x = 0; x < image.width; x++) {
      const t = ty * w + (xmap[x] as number);
      const o = (y * image.width + x) * 4;
      rgb[t * 3] += d[o] as number;
      rgb[t * 3 + 1] += d[o + 1] as number;
      rgb[t * 3 + 2] += d[o + 2] as number;
      count[t] += 1;
    }
  }
  for (let t = 0; t < w * h; t++) {
    const c = count[t] || 1;
    rgb[t * 3] /= c;
    rgb[t * 3 + 1] /= c;
    rgb[t * 3 + 2] /= c;
  }
  return { width: w, height: h, scale: w / image.width, rgb };
}

/** Colour edge strength, squashed so that every clear edge counts about the same. */
export function buildEdgeMap(image: ImageLike, maxSide = 520, blurRadii: readonly number[] = [5, 2, 1, 0]): EdgeMap {
  const small = downscaleRgb(image, maxSide);
  const w = small.width;
  const h = small.height;
  const g = new Float32Array(w * h);
  const rgb = small.rgb;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let m = 0;
      for (let c = 0; c < 3; c++) {
        const gx = (rgb[(y * w + x + 1) * 3 + c] as number) - (rgb[(y * w + x - 1) * 3 + c] as number);
        const gy = (rgb[((y + 1) * w + x) * 3 + c] as number) - (rgb[((y - 1) * w + x) * 3 + c] as number);
        m += gx * gx + gy * gy;
      }
      g[y * w + x] = Math.sqrt(m);
    }
  }
  const knee = 30;
  for (let i = 0; i < g.length; i++) g[i] = (g[i] as number) / ((g[i] as number) + knee);
  return { width: w, height: h, scale: small.scale, levels: blurRadii.map((r) => boxBlur(g, w, h, r)) };
}

function lookup(map: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  return (
    ((map[y0 * w + x0] as number) * (1 - tx) + (map[y0 * w + x1] as number) * tx) * (1 - ty) +
    ((map[y1 * w + x0] as number) * (1 - tx) + (map[y1 * w + x1] as number) * tx) * ty
  );
}

const LINE_SAMPLES = 30;
const CELL_OFFSETS = [0.5, 0.5, 0.36, 0.36, 0.64, 0.36, 0.36, 0.64, 0.64, 0.64];
const CELL_POINTS = CELL_OFFSETS.length / 2;
/** How much an edge found one sticker width outside the outline counts against it. */
const OUTSIDE_WEIGHT = 0.5;

/** Sides of a quad that are on the silhouette of the cube: nothing grid-like should continue beyond them. */
export const OUTSIDE_LEFT = 1;
export const OUTSIDE_RIGHT = 2;
export const OUTSIDE_TOP = 4;
export const OUTSIDE_BOTTOM = 8;
export const OUTSIDE_ALL = 15;

/**
 * Mean edge strength on the grid lines minus mean edge strength inside the stickers, minus a penalty
 * for grid lines that would continue one sticker beyond the sides flagged in `outside` (which tells a
 * correctly placed grid from one that is a whole sticker off). Quad in image pixels.
 */
export function gridScore(edge: EdgeMap, level: number, quad: Quad, lineSamples = LINE_SAMPLES, cellSamples = CELL_POINTS, outside = 0): number {
  if (!isUsableQuad(quad)) return -1;
  const map = edge.levels[level] as Float32Array;
  const w = edge.width;
  const hgt = edge.height;
  const m = squareToQuad(quad);
  const s = edge.scale;
  const m0 = m[0] * s;
  const m1 = m[1] * s;
  const m2 = m[2] * s;
  const m3 = m[3] * s;
  const m4 = m[4] * s;
  const m5 = m[5] * s;
  const m6 = m[6];
  const m7 = m[7];
  const at = (u: number, v: number): number => {
    const d = m6 * u + m7 * v + 1;
    return lookup(map, w, hgt, (m0 * u + m1 * v + m2) / d, (m3 * u + m4 * v + m5) / d);
  };
  let lines = 0;
  for (let i = 0; i <= 6; i++) {
    for (let k = 0; k < lineSamples; k++) {
      const t = (k + 0.5) / lineSamples;
      lines += at(i / 6, t) + at(t, i / 6);
    }
  }
  let cells = 0;
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 6; c++)
      for (let j = 0; j < cellSamples; j++) cells += at((c + (CELL_OFFSETS[j * 2] as number)) / 6, (r + (CELL_OFFSETS[j * 2 + 1] as number)) / 6);
  let score = lines / (14 * lineSamples) - cells / (36 * cellSamples);
  if (outside) {
    let ext = 0;
    let sides = 0;
    for (let bit = 0; bit < 4; bit++) {
      if (!(outside & (1 << bit))) continue;
      sides++;
      const pos = bit === 0 || bit === 2 ? -1 / 6 : 7 / 6;
      for (let k = 0; k < lineSamples; k++) {
        const t = (k + 0.5) / lineSamples;
        ext += bit < 2 ? at(pos, t) : at(t, pos);
      }
    }
    score -= (OUTSIDE_WEIGHT * ext) / (sides * lineSamples);
  }
  return score;
}

/**
 * Coordinate descent on the point positions, coarse to fine. quadsOf turns the points into the quads
 * to score (one quad for a single face, three for a corner outline); outside gives the silhouette
 * sides of each quad. maxShift is the largest initial step in image pixels.
 */
export function refinePoints(
  edge: EdgeMap,
  start: readonly Point[],
  quadsOf: (pts: Point[]) => Quad[],
  maxShift: number,
  outside: readonly number[] = [],
  /** First blur level to use (0 = coarsest) and samples per grid line: later levels and fewer samples are faster for small corrections. */
  startLevel = 0,
  lineSamples = LINE_SAMPLES,
): { points: Point[]; score: number } {
  const pts = start.map((p) => ({ x: p.x, y: p.y }));
  // With several quads (a corner outline) moving one point leaves some quads as they were: their scores
  // are kept from the last accepted position instead of being worked out again. The result is the same.
  let baseCoords: number[][] = [];
  let baseScores: number[] = [];
  let baseLevel = -1;
  let trialCoords: number[][] = [];
  let trialScores: number[] = [];
  const total = (level: number): number => {
    let s = 0;
    const quads = quadsOf(pts);
    if (level !== baseLevel) {
      baseCoords = [];
      baseScores = [];
      baseLevel = level;
    }
    trialCoords = [];
    trialScores = [];
    let failed = false;
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i] as Quad;
      const coords = [q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y];
      const b = baseCoords[i];
      let v: number;
      if (b && b[0] === coords[0] && b[1] === coords[1] && b[2] === coords[2] && b[3] === coords[3] && b[4] === coords[4] && b[5] === coords[5] && b[6] === coords[6] && b[7] === coords[7]) v = baseScores[i] as number;
      else v = gridScore(edge, level, q, lineSamples, CELL_POINTS, outside[i] || 0);
      trialCoords.push(coords);
      trialScores.push(v);
      if (v <= -1) failed = true;
      s += v;
    }
    return failed ? -1e9 : s / quads.length;
  };
  const accept = (): void => {
    baseCoords = trialCoords;
    baseScores = trialScores;
  };
  const minStep = 0.35 / edge.scale;
  let score = 0;
  for (let level = Math.min(startLevel, edge.levels.length - 1); level < edge.levels.length; level++) {
    let step = Math.max(minStep, maxShift / Math.pow(2, level - startLevel));
    score = total(level);
    accept();
    let guard = 0;
    while (step >= minStep && guard++ < 200) {
      let improved = false;
      for (const p of pts) {
        for (const axis of ['x', 'y'] as const) {
          for (const dir of [-1, 1]) {
            const old = p[axis];
            p[axis] = old + dir * step;
            const s = total(level);
            if (s > score + 1e-6) {
              score = s;
              improved = true;
              accept();
            } else {
              p[axis] = old;
            }
          }
        }
      }
      if (!improved) step /= 2;
    }
  }
  return { points: pts, score };
}

/** Silhouette sides of the three quads of a corner outline (top, left, right). */
export const CORNER_OUTSIDE: readonly number[] = [OUTSIDE_TOP | OUTSIDE_LEFT, OUTSIDE_LEFT | OUTSIDE_BOTTOM, OUTSIDE_RIGHT | OUTSIDE_BOTTOM];

/** Snaps a hand-placed face outline onto the sticker grid. */
export function refineQuad(edge: EdgeMap, quad: Quad, maxShift: number): { quad: Quad; score: number } {
  const r = refinePoints(edge, quad, (p) => [[p[0] as Point, p[1] as Point, p[2] as Point, p[3] as Point]], maxShift, [OUTSIDE_ALL]);
  return { quad: r.points as Quad, score: r.score };
}
