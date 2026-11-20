/**
 * Video clips of the five real reference photos for the camera-path measurement: each photo is
 * cropped to the 3:4 shape of the camera view around the cube and moved a few pixels from frame to
 * frame (an approach from off centre, then hand shake), since a still photo has no other motion to offer.
 *
 *   npx tsx tools/synth/real-clips.ts --out /tmp/vz-real-clips
 *
 * The frames are derived from Ahmad's photos, so the default output is outside the repository; delete
 * it after the measurement. Writes two "cubes" in the layout of tools/synth/clips.ts, one per photo
 * pair of the quick scan (1 then 3, 5 then 4), with the hand-read colours as the true state.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { readImage } from './node-image';
import { mulberry32 } from './shot';
import { snapOutline } from '../../src/vision/load';
import type { CornerOutline } from '../../src/vision/types';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const out = arg('out', '/tmp/vz-real-clips');
const DIR = process.env.HOME + '/.capy/drive/captain-rubic/handoffs/reference-photos/';
const APPROACH = 6;
const HOLD = 20;
const FPS = 10;
const W = 744;
const H = 992;

const outlines = (JSON.parse(readFileSync(new URL('./real-outlines.json', import.meta.url), 'utf8')) as { photos: Record<string, number[][]> }).photos;
const truth = (JSON.parse(readFileSync(new URL('./real-truth.json', import.meta.url), 'utf8')) as { photos: Record<string, { view: { top: number; left: number; right: number } }> }).photos;
const state = (JSON.parse(readFileSync('tmp/vision/reference-state.json', 'utf8')) as { state: number[]; colours: string[] });

const cubes: string[] = [];
for (const pair of [
  [1, 3],
  [5, 4],
]) {
  const name = 'real-pair-' + pair.join('');
  cubes.push(name);
  const shots: Record<string, unknown>[] = [];
  pair.forEach((n, vi) => {
    const key = 'cube-corner-' + n;
    const img = readImage(DIR + key + '.jpeg');
    const hand = (outlines[key] as number[][]).map((p) => ({ x: p[0] as number, y: p[1] as number })) as CornerOutline;
    const snapped = snapOutline(img, hand);
    const xs = snapped.map((p) => p.x);
    const ys = snapped.map((p) => p.y);
    const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
    const rnd = mulberry32(977 * n);
    const r = (a: number, b: number) => a + (b - a) * rnd();
    const amp = r(2, 6);
    const ph = [r(0, 6.28), r(0, 6.28), r(0, 6.28), r(0, 6.28)];
    const from = { x: r(40, 70) * (rnd() < 0.5 ? -1 : 1), y: r(40, 70) * (rnd() < 0.5 ? -1 : 1) };
    const shift = (i: number): { x: number; y: number } => {
      const a = (2 * Math.PI * i) / HOLD;
      return { x: amp * (0.6 * Math.sin(a + (ph[0] as number)) + 0.4 * Math.sin(3 * a + (ph[1] as number))), y: amp * (0.6 * Math.sin(a + (ph[2] as number)) + 0.4 * Math.sin(3 * a + (ph[3] as number))) };
    };
    const offsets: { x: number; y: number }[] = [];
    for (let j = 0; j < APPROACH; j++) {
      const t = (j + 1) / (APPROACH + 1);
      const s = 1 - t * t * (3 - 2 * t);
      offsets.push({ x: shift(0).x + s * from.x, y: shift(0).y + s * from.y });
    }
    for (let i = 0; i < HOLD; i++) offsets.push(shift(i));
    const dir = out + '/' + name + '/corner-' + vi;
    mkdirSync(dir, { recursive: true });
    const frames: number[][][] = [];
    offsets.forEach((o, fi) => {
      // Whole-pixel moves of the crop window: the cube appears to move the other way.
      const x0 = Math.round(cx - W / 2 - o.x);
      const y0 = Math.round(cy - H / 2 - o.y);
      const data = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const sx = Math.min(img.width - 1, Math.max(0, x0 + x));
          const sy = Math.min(img.height - 1, Math.max(0, y0 + y));
          const s = (sy * img.width + sx) * 4;
          const d = (y * W + x) * 4;
          data[d] = img.data[s] as number;
          data[d + 1] = img.data[s + 1] as number;
          data[d + 2] = img.data[s + 2] as number;
          data[d + 3] = 255;
        }
      writeFileSync(dir + '/f-' + String(fi).padStart(3, '0') + '.jpg', jpeg.encode({ data, width: W, height: H }, 95).data);
      frames.push(snapped.map((p) => [p.x - x0, p.y - y0]));
    });
    shots.push({ kind: 'corner', label: 'corner-' + vi, view: (truth[key] as { view: unknown }).view, dir: 'corner-' + vi, fps: FPS, approach: APPROACH, hold: HOLD, amplitude: amp, photo: key, frames });
  });
  writeFileSync(out + '/' + name + '/meta.json', JSON.stringify({ name, condition: 'real', colourNames: state.colours, state: state.state, shots }));
}
writeFileSync(out + '/index.json', JSON.stringify({ fps: FPS, approach: APPROACH, hold: HOLD, cubes }, null, 1));
console.log('wrote', cubes.join(', '), '->', out);
