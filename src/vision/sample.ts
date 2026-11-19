/** Reads the 36 sticker colours of one face from a photo, given the face outline. */
import { rgbToLab } from './color';
import { applyMat3, squareToQuad } from './homography';
import type { FaceSample, ImageLike, Quad } from './types';

/** Fraction of a sticker cut off on every side before sampling, to stay clear of gaps, bevels and neighbours. */
const MARGIN = 0.24;
/** Sample points per sticker side. */
const GRID = 9;

const scratchR = new Float32Array(GRID * GRID);
const scratchG = new Float32Array(GRID * GRID);
const scratchB = new Float32Array(GRID * GRID);
const scratchKeep = new Uint8Array(GRID * GRID);
const scratchSort = new Float32Array(GRID * GRID);

function median(values: Float32Array, keep: Uint8Array, n: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) if (keep[i]) scratchSort[m++] = values[i] as number;
  if (m === 0) return 0;
  const s = scratchSort.subarray(0, m).sort();
  return m % 2 ? (s[(m - 1) / 2] as number) : ((s[m / 2 - 1] as number) + (s[m / 2] as number)) / 2;
}

/** Bilinear lookup; coordinates are clamped to the image. Writes into out[0..2]. */
export function bilinear(image: ImageLike, x: number, y: number, out: Float32Array | number[]): void {
  const w = image.width;
  const h = image.height;
  const fx = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  const fy = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const tx = fx - x0;
  const ty = fy - y0;
  const d = image.data;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = (d[i00 + c] as number) * (1 - tx) + (d[i10 + c] as number) * tx;
    const bottom = (d[i01 + c] as number) * (1 - tx) + (d[i11 + c] as number) * tx;
    out[c] = top * (1 - ty) + bottom * ty;
  }
}

/**
 * Samples each sticker from its inner area. Blown-out highlight pixels are ignored, and the colour is
 * the mean of the pixels close to the per-channel median, so a glare spot, a logo or a sliver of a
 * neighbouring sticker does not pull the value.
 */
export function sampleFace(image: ImageLike, quad: Quad): FaceSample {
  const h = squareToQuad(quad);
  const rgb = new Float32Array(108);
  const lab = new Float32Array(108);
  const quality = new Float32Array(36);
  const n = GRID * GRID;
  const px = [0, 0, 0];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      let blown = 0;
      let outside = 0;
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const u = (col + MARGIN + ((1 - 2 * MARGIN) * (i + 0.5)) / GRID) / 6;
          const v = (row + MARGIN + ((1 - 2 * MARGIN) * (j + 0.5)) / GRID) / 6;
          const p = applyMat3(h, u, v);
          if (p.x < 0 || p.y < 0 || p.x > image.width - 1 || p.y > image.height - 1) outside++;
          bilinear(image, p.x, p.y, px);
          const k = j * GRID + i;
          scratchR[k] = px[0] as number;
          scratchG[k] = px[1] as number;
          scratchB[k] = px[2] as number;
          const isBlown = Math.min(px[0] as number, px[1] as number, px[2] as number) >= 242;
          scratchKeep[k] = isBlown ? 0 : 1;
          if (isBlown) blown++;
        }
      }
      // A sticker that is blown out almost everywhere is either white or lost to glare: keep its pixels.
      let glare = blown / n;
      if (glare > 0.7) {
        scratchKeep.fill(1);
      }
      const mr = median(scratchR, scratchKeep, n);
      const mg = median(scratchG, scratchKeep, n);
      const mb = median(scratchB, scratchKeep, n);
      let dev = 0;
      let kept = 0;
      for (let k = 0; k < n; k++) {
        if (!scratchKeep[k]) continue;
        scratchSort[kept++] = Math.abs((scratchR[k] as number) - mr) + Math.abs((scratchG[k] as number) - mg) + Math.abs((scratchB[k] as number) - mb);
      }
      const sorted = scratchSort.subarray(0, kept).sort();
      dev = kept ? (sorted[Math.floor(kept / 2)] as number) : 0;
      const limit = Math.max(24, 3 * dev);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let inliers = 0;
      for (let k = 0; k < n; k++) {
        if (!scratchKeep[k]) continue;
        const d = Math.abs((scratchR[k] as number) - mr) + Math.abs((scratchG[k] as number) - mg) + Math.abs((scratchB[k] as number) - mb);
        if (d > limit) continue;
        sr += scratchR[k] as number;
        sg += scratchG[k] as number;
        sb += scratchB[k] as number;
        inliers++;
      }
      if (inliers === 0) {
        sr = mr;
        sg = mg;
        sb = mb;
        inliers = 1;
      }
      const r = sr / inliers;
      const g = sg / inliers;
      const b = sb / inliers;
      const idx = row * 6 + col;
      rgb[idx * 3] = r;
      rgb[idx * 3 + 1] = g;
      rgb[idx * 3 + 2] = b;
      const l = rgbToLab(r, g, b);
      lab[idx * 3] = l[0];
      lab[idx * 3 + 1] = l[1];
      lab[idx * 3 + 2] = l[2];
      // Quality: share of pixels that agree, penalised for glare, for spread and for very dark samples.
      // Blown out almost everywhere: white, or a colour lost to glare. Report it, but as a weak sample.
      if (glare > 0.7) glare = 0.75;
      const agree = inliers / n;
      const spread = Math.exp(-((dev / 40) * (dev / 40)));
      const dark = Math.min(1, Math.max(r, g, b) / 60);
      const inside = 1 - outside / n;
      quality[idx] = Math.max(0, Math.min(1, agree * (1 - glare) * spread * dark * inside));
    }
  }
  return { rgb, lab, quality };
}

/** Builds a FaceSample from 36 known sRGB colours (for tests and for manual entry). */
export function faceSampleFromRgb(values: ArrayLike<number>, quality?: ArrayLike<number>): FaceSample {
  const rgb = new Float32Array(108);
  const lab = new Float32Array(108);
  const q = new Float32Array(36);
  for (let i = 0; i < 36; i++) {
    const r = values[i * 3] as number;
    const g = values[i * 3 + 1] as number;
    const b = values[i * 3 + 2] as number;
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    const l = rgbToLab(r, g, b);
    lab[i * 3] = l[0];
    lab[i * 3 + 1] = l[1];
    lab[i * 3 + 2] = l[2];
    q[i] = quality ? (quality[i] as number) : 1;
  }
  return { rgb, lab, quality: q };
}

/** Warps the quad to a square crop of the given size (for previews and debugging). */
export function rectifyFace(image: ImageLike, quad: Quad, size: number): { width: number; height: number; data: Uint8ClampedArray } {
  const h = squareToQuad(quad);
  const data = new Uint8ClampedArray(size * size * 4);
  const px = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = applyMat3(h, (x + 0.5) / size, (y + 0.5) / size);
      bilinear(image, p.x, p.y, px);
      const o = (y * size + x) * 4;
      data[o] = px[0] as number;
      data[o + 1] = px[1] as number;
      data[o + 2] = px[2] as number;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}
