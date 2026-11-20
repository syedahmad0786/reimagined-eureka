/** Node-side image helpers for the vision tools and tests (not used in the browser). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export interface NodeImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function readImage(path: string): NodeImage {
  const buf = readFileSync(path);
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) };
  }
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length) };
}

export function writePng(path: string, image: NodeImage): void {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  writeFileSync(path, PNG.sync.write(png));
}

export function blank(width: number, height: number, rgb: [number, number, number] = [0, 0, 0]): NodeImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function setPixel(img: NodeImage, x: number, y: number, rgb: readonly number[]): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return;
  const o = (yi * img.width + xi) * 4;
  img.data[o] = rgb[0] as number;
  img.data[o + 1] = rgb[1] as number;
  img.data[o + 2] = rgb[2] as number;
  img.data[o + 3] = 255;
}

export function drawLine(img: NodeImage, x0: number, y0: number, x1: number, y1: number, rgb: readonly number[], thickness = 1): void {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (let dy = 0; dy < thickness; dy++) for (let dx = 0; dx < thickness; dx++) setPixel(img, x + dx - (thickness - 1) / 2, y + dy - (thickness - 1) / 2, rgb);
  }
}

export function fillRect(img: NodeImage, x: number, y: number, w: number, h: number, rgb: readonly number[]): void {
  for (let yy = Math.max(0, Math.round(y)); yy < Math.min(img.height, Math.round(y + h)); yy++)
    for (let xx = Math.max(0, Math.round(x)); xx < Math.min(img.width, Math.round(x + w)); xx++) setPixel(img, xx, yy, rgb);
}

export function blit(dst: NodeImage, src: NodeImage, x: number, y: number): void {
  for (let yy = 0; yy < src.height; yy++)
    for (let xx = 0; xx < src.width; xx++) {
      const o = (yy * src.width + xx) * 4;
      setPixel(dst, x + xx, y + yy, [src.data[o] as number, src.data[o + 1] as number, src.data[o + 2] as number]);
    }
}

/** Crops and scales (nearest neighbour for upscaling, box filter for downscaling by an integer factor). */
export function cropScale(src: NodeImage, x0: number, y0: number, w: number, h: number, scale: number): NodeImage {
  const out = blank(Math.round(w * scale), Math.round(h * scale));
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const sx = Math.min(src.width - 1, Math.max(0, Math.floor(x0 + x / scale)));
      const sy = Math.min(src.height - 1, Math.max(0, Math.floor(y0 + y / scale)));
      const o = (sy * src.width + sx) * 4;
      setPixel(out, x, y, [src.data[o] as number, src.data[o + 1] as number, src.data[o + 2] as number]);
    }
  return out;
}
