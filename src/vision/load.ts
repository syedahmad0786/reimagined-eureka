/** Decoding user photos into ImageData at the working size. Browser only. */
import { detectFaceQuad } from './detect';
import { cornerQuads } from './corner';
import { buildEdgeMap, refinePoints, refineQuad, CORNER_OUTSIDE } from './refine';
import type { CornerOutline, ImageLike, Quad } from './types';

/** Long side, in pixels, that photos are scaled down to before recognition. */
export const WORKING_SIZE = 1000;

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Draws any image source scaled so its long side is at most maxSide and returns the pixels. */
export function toImageData(source: CanvasImageSource, width: number, height: number, maxSide = WORKING_SIZE): ImageData {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('This browser cannot read image pixels.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Copies ImageData onto a canvas, for the editors and for previews. */
export function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  (c.getContext('2d') as CanvasRenderingContext2D).putImageData(image, 0, 0);
  return c;
}

/**
 * Decodes a user-supplied file (JPEG, PNG, WebP, and HEIC where the browser can), honouring the EXIF
 * orientation, scaled down to the working size.
 */
export async function loadImageFile(file: Blob): Promise<ImageData> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      try {
        return toImageData(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      // Fall through to the <img> route, which decodes a few formats createImageBitmap does not.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('This photo could not be opened. Try a JPEG or PNG, or take the photo with the camera button.'));
      img.src = url;
    });
    return toImageData(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Moves a roughly placed face outline onto the sticker grid of the photo. Returns the input when the photo gives no better fit. */
export function snapQuad(image: ImageLike, quad: Quad): Quad {
  try {
    const side = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
    return refineQuad(buildEdgeMap(image, 1000), quad, Math.max(2, side / 30)).quad;
  } catch {
    return quad;
  }
}

/** Moves a roughly placed corner outline onto the sticker grids of the photo. */
export function snapOutline(image: ImageLike, outline: CornerOutline): CornerOutline {
  try {
    const xs = outline.map((p) => p.x);
    const width = Math.max(...xs) - Math.min(...xs);
    return refinePoints(buildEdgeMap(image, 1000), outline, (p) => cornerQuads(p as CornerOutline), Math.max(2, width / 60), CORNER_OUTSIDE).points as CornerOutline;
  } catch {
    return outline;
  }
}

/**
 * Best outline for a face when a rough one is already known, such as the camera guide the user aimed
 * with: looks for the face in the photo, and accepts what it finds only when that lies close to the
 * rough outline; otherwise the rough outline is snapped to the nearest grid. The result keeps the
 * corner order (which way is up) of the rough outline.
 */
export function locateFaceNear(image: ImageLike, rough: Quad): { quad: Quad; confidence: number; found: boolean } {
  const side = (Math.hypot(rough[1].x - rough[0].x, rough[1].y - rough[0].y) + Math.hypot(rough[3].x - rough[0].x, rough[3].y - rough[0].y)) / 2;
  const det = detectFaceQuad(image);
  let best = Infinity;
  let rot = 0;
  for (let r = 0; r < 4; r++) {
    let e = 0;
    for (let k = 0; k < 4; k++) e = Math.max(e, Math.hypot((det.quad[(k + r) % 4] as { x: number }).x - rough[k]!.x, (det.quad[(k + r) % 4] as { y: number }).y - rough[k]!.y));
    if (e < best) {
      best = e;
      rot = r;
    }
  }
  if (det.confidence >= 0.5 && best < 0.3 * side) {
    return { quad: [0, 1, 2, 3].map((k) => det.quad[(k + rot) % 4]) as Quad, confidence: det.confidence, found: true };
  }
  return { quad: snapQuad(image, rough), confidence: 0, found: false };
}
