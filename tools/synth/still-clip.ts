/**
 * A video clip made from one still photo by moving the camera in the image plane: an approach from
 * further away, off centre and turned, then a hold with hand shake and a slow drift, written straight
 * to a .y4m file (the format Chromium's fake camera plays). The transform of every frame is known, so
 * the true outline of every frame is too. Reflections do not move in such a clip; for that, see the
 * rendered clips of tools/synth/clips.ts.
 */
import { closeSync, openSync, writeSync } from 'node:fs';
import type { NodeImage } from './node-image';
import { mulberry32 } from './shot';

export const STILL_APPROACH = 6;
export const STILL_HOLD = 20;
export const STILL_FPS = 10;

export interface StillClip {
  /** The true outline in every frame (x, y pairs in frame pixels). */
  frames: number[][][];
  /** Hand shake amplitude in stickers. */
  amplitude: number;
  fps: number;
}

/**
 * truth: the outline in the still (4 or 7 points). sticker: length of one sticker edge in pixels,
 * which sets the size of the shake. Frames have the size of the still, cut to even numbers.
 */
export function writeStillClip(image: NodeImage, truth: number[][], sticker: number, seed: number, path: string): StillClip {
  const W = image.width - (image.width % 2);
  const H = image.height - (image.height % 2);
  const rnd = mulberry32(seed);
  const r = (a: number, b: number) => a + (b - a) * rnd();
  // The same motion as tools/synth/clips.ts: 0.06 to 0.22 sticker widths of shake (0.7 to 2.5 mm on a 68 mm cube).
  const amplitude = r(0.06, 0.22);
  const amp = amplitude * sticker;
  const drift = r(-0.2, 0.2) * sticker;
  const ph = Array.from({ length: 6 }, () => r(0, Math.PI * 2));
  const from = { x: r(1.4, 2.4) * sticker * (rnd() < 0.5 ? -1 : 1), y: r(1.0, 2.0) * sticker * (rnd() < 0.5 ? -1 : 1), far: r(0.25, 0.4), roll: r(6, 12) * (rnd() < 0.5 ? -1 : 1) };
  const pose = (n: number): { dx: number; dy: number; zoom: number; roll: number } => {
    const i = Math.max(0, n - STILL_APPROACH);
    const a = (2 * Math.PI * i) / STILL_HOLD;
    const wobble = (amplitude / 0.12) * 0.5;
    let dx = amp * (0.6 * Math.sin(a + (ph[0] as number)) + 0.4 * Math.sin(3 * a + (ph[1] as number))) + drift * Math.sin(a / 2) * Math.sin(a / 2);
    let dy = amp * (0.6 * Math.sin(a + (ph[2] as number)) + 0.4 * Math.sin(3 * a + (ph[3] as number)));
    let zoom = 1 + 0.006 * Math.sin(a + (ph[4] as number));
    let roll = wobble * Math.sin(2 * a + (ph[5] as number));
    if (n < STILL_APPROACH) {
      const t = (n + 1) / (STILL_APPROACH + 1);
      const s = 1 - t * t * (3 - 2 * t);
      dx += s * from.x;
      dy += s * from.y;
      zoom /= 1 + s * from.far;
      roll += s * from.roll;
    }
    return { dx, dy, zoom, roll: (roll * Math.PI) / 180 };
  };
  const cx = W / 2;
  const cy = H / 2;
  const fd = openSync(path, 'w');
  writeSync(fd, 'YUV4MPEG2 W' + W + ' H' + H + ' F' + STILL_FPS + ':1 Ip A1:1 C420jpeg XYSCSS=420JPEG XCOLORRANGE=LIMITED\n');
  const rgb = new Float32Array(W * H * 3);
  const yPlane = Buffer.alloc(W * H);
  const uPlane = Buffer.alloc((W / 2) * (H / 2));
  const vPlane = Buffer.alloc((W / 2) * (H / 2));
  const src = image.data;
  const sw = image.width;
  const sh = image.height;
  const reflect = (v: number, n: number): number => {
    // Mirror at the borders, so the table simply continues where the camera looks past the photo.
    const period = 2 * (n - 1);
    let m = v % period;
    if (m < 0) m += period;
    return m > n - 1 ? period - m : m;
  };
  const frames: number[][][] = [];
  let noise = (seed * 2654435761) >>> 0;
  for (let n = 0; n < STILL_APPROACH + STILL_HOLD; n++) {
    const p = pose(n);
    const cos = Math.cos(p.roll);
    const sin = Math.sin(p.roll);
    // Forward: out = c + d + zoom * R(roll) * (in - c).
    frames.push(truth.map(([x, y]) => [cx + p.dx + p.zoom * (cos * ((x as number) - cx) - sin * ((y as number) - cy)), cy + p.dy + p.zoom * (sin * ((x as number) - cx) + cos * ((y as number) - cy))]));
    const k = 1 / p.zoom;
    for (let y = 0; y < H; y++) {
      const ry = y - cy - p.dy;
      for (let x = 0; x < W; x++) {
        const rx = x - cx - p.dx;
        const fx = reflect(cx + k * (cos * rx + sin * ry), sw);
        const fy = reflect(cy + k * (-sin * rx + cos * ry), sh);
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = x0 + 1 < sw ? x0 + 1 : x0;
        const y1 = y0 + 1 < sh ? y0 + 1 : y0;
        const tx = fx - x0;
        const ty = fy - y0;
        const a = (y0 * sw + x0) * 4;
        const b = (y0 * sw + x1) * 4;
        const c = (y1 * sw + x0) * 4;
        const d = (y1 * sw + x1) * 4;
        // A little sensor noise that changes from frame to frame.
        noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
        const jitter = ((noise >>> 8) / 16777216 - 0.5) * 5;
        const o = (y * W + x) * 3;
        for (let ch = 0; ch < 3; ch++) rgb[o + ch] = ((src[a + ch] as number) * (1 - tx) + (src[b + ch] as number) * tx) * (1 - ty) + ((src[c + ch] as number) * (1 - tx) + (src[d + ch] as number) * tx) * ty + jitter;
      }
    }
    // BT.601, limited range, 4:2:0.
    for (let i = 0; i < W * H; i++) yPlane[i] = Math.max(0, Math.min(255, Math.round(16 + 0.25679 * (rgb[i * 3] as number) + 0.50413 * (rgb[i * 3 + 1] as number) + 0.09791 * (rgb[i * 3 + 2] as number))));
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2) {
        let R = 0;
        let G = 0;
        let B = 0;
        for (const o of [(y * W + x) * 3, (y * W + x + 1) * 3, ((y + 1) * W + x) * 3, ((y + 1) * W + x + 1) * 3]) {
          R += rgb[o] as number;
          G += rgb[o + 1] as number;
          B += rgb[o + 2] as number;
        }
        const i = (y / 2) * (W / 2) + x / 2;
        uPlane[i] = Math.max(0, Math.min(255, Math.round(128 + (-0.14822 * R - 0.29099 * G + 0.43922 * B) / 4)));
        vPlane[i] = Math.max(0, Math.min(255, Math.round(128 + (0.43922 * R - 0.36779 * G - 0.07143 * B) / 4)));
      }
    writeSync(fd, 'FRAME\n');
    writeSync(fd, yPlane);
    writeSync(fd, uPlane);
    writeSync(fd, vPlane);
  }
  closeSync(fd);
  return { frames, amplitude, fps: STILL_FPS };
}
