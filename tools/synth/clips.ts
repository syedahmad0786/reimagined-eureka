/**
 * Renders short video clips of synthetic cubes for the camera-path measurement: every clip is one
 * photo situation of the photo set (same cubes, same conditions) seen through a hand-held camera.
 *
 *   npx vite --port 5182 --strictPort            (in another shell, from the repo root)
 *   npx tsx tools/synth/clips.ts --out tmp/vision/clips/c1 --per 3 --seed 1 [--only glare,easy] [--pages 2] [--port 5182]
 *
 * A clip is APPROACH frames in which the camera comes in from further away, off centre and turned,
 * followed by HOLD frames in which it is held on the cube with hand shake and a slow drift, at FPS
 * frames a second. The hold part is periodic, so the clip can be looped. The lamps stay where they
 * are while the camera moves, so reflections move over the stickers as they do in a hand.
 * Per cube it writes <cube>/<shot>/f-000.jpg ... and meta.json with the true state and the true
 * outline of every frame. tools/synth/camera-eval.ts turns the frames into .y4m files and plays them
 * to Chromium as a fake camera.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { CONDITIONS, PALETTES, PALETTE_NAMES, paletteFor, randomState, shotFor, type Condition } from './conditions';
import { mulberry32, type ShotParams, type ShotResult } from './shot';
import { TWO_SHOT_VIEWS } from '../../src/vision/corner';

export const APPROACH = 6;
export const HOLD = 20;
export const FPS = 10;

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const out = arg('out', 'tmp/vision/clips/c1');
const per = Number(arg('per', '3'));
const seed = Number(arg('seed', '1'));
const pagesWanted = Number(arg('pages', '2'));
const only = arg('only', '');
const port = arg('port', '5182');
const host = arg('host', 'localhost');
const conditions = (only ? only.split(',') : [...CONDITIONS]) as Condition[];

type Camera = ShotParams['camera'];

/** The camera positions of a clip around the position the photo was taken from. */
function clipCameras(base: Camera, kind: 'face' | 'corner', rnd: () => number): { cameras: Camera[]; amplitude: number; drift: number } {
  const r = (a: number, b: number) => a + (b - a) * rnd();
  // Hand shake: 0.06 to 0.22 cube units, which is 0.7 to 2.5 mm on a 68 mm cube; a corner shot is taken from further away.
  const amplitude = r(0.06, 0.22) * (kind === 'corner' ? 1.5 : 1);
  const drift = r(-0.2, 0.2);
  const ph = Array.from({ length: 8 }, () => r(0, Math.PI * 2));
  const from = { x: r(1.4, 2.4) * (rnd() < 0.5 ? -1 : 1), y: r(1.0, 2.0) * (rnd() < 0.5 ? -1 : 1), far: r(0.25, 0.4), roll: r(6, 12) * (rnd() < 0.5 ? -1 : 1) };
  const cameras: Camera[] = [];
  const hold = (i: number): Camera => {
    const a = (2 * Math.PI * i) / HOLD;
    const wobble = (amplitude / 0.12) * 0.5;
    return {
      ...base,
      aimX: base.aimX + amplitude * (0.6 * Math.sin(a + (ph[0] as number)) + 0.4 * Math.sin(3 * a + (ph[1] as number))) + drift * Math.sin(a / 2) * Math.sin(a / 2),
      aimY: base.aimY + amplitude * (0.6 * Math.sin(a + (ph[2] as number)) + 0.4 * Math.sin(3 * a + (ph[3] as number))),
      rollDeg: base.rollDeg + wobble * Math.sin(2 * a + (ph[4] as number)),
      distance: base.distance * (1 + 0.006 * Math.sin(a + (ph[5] as number))),
      tiltDeg: Math.max(0, base.tiltDeg + wobble * Math.sin(a + (ph[6] as number))),
      elevationDeg: base.elevationDeg + wobble * Math.sin(a + (ph[6] as number)),
      swingDeg: base.swingDeg + wobble * Math.sin(a + (ph[7] as number)),
    };
  };
  const first = hold(0);
  for (let j = 0; j < APPROACH; j++) {
    const t = (j + 1) / (APPROACH + 1);
    const s = 1 - t * t * (3 - 2 * t);
    cameras.push({ ...first, aimX: first.aimX + s * from.x, aimY: first.aimY + s * from.y, distance: first.distance * (1 + s * from.far), rollDeg: first.rollDeg + s * from.roll });
  }
  for (let i = 0; i < HOLD; i++) cameras.push(hold(i));
  return { cameras, amplitude, drift };
}

interface Job {
  dir: string;
  params: ShotParams;
  cameras: Camera[];
  record: Record<string, unknown>;
}

const jobs: Job[] = [];
const metas: { dir: string; meta: Record<string, unknown> }[] = [];
let cubeIndex = 0;
for (const cond of conditions) {
  for (let k = 0; k < per; k++) {
    // The same seeds as generate.ts, so cube k of a condition is the same cube as in the photo set.
    const cubeSeed = seed * 100003 + CONDITIONS.indexOf(cond) * 1009 + k;
    const rnd = mulberry32(cubeSeed);
    const state = randomState(rnd);
    const { palette, style } = paletteFor(cond);
    const name = 'cube-' + String(cubeIndex++).padStart(3, '0') + '-' + cond;
    const dir = out + '/' + name;
    const shots: Record<string, unknown>[] = [];
    const add = (kind: 'face' | 'corner', label: string, extra: Partial<ShotParams>, base: ReturnType<typeof shotFor>): void => {
      const shake = mulberry32(base.seed ^ 0x5eed);
      const camera = { ...base.camera };
      // The user is asked to fill the guide: keep the hold position within what the guide accepts.
      if (kind === 'face') camera.distance = Math.max(10.5, Math.min(14.5, camera.distance));
      // Video frames are not JPEG files: 0.95 is only the quality the frames travel in.
      const params = { ...base, camera, post: { ...base.post, jpegQuality: 0.95 }, state, palette: PALETTES[palette] as string[], style, ...extra } as ShotParams;
      const clip = clipCameras(camera, kind, shake);
      const record: Record<string, unknown> = { kind, label, ...extra, dir: label, fps: FPS, approach: APPROACH, hold: HOLD, amplitude: clip.amplitude, drift: clip.drift, params: { ...params, state: undefined, palette: undefined }, frames: [] };
      shots.push(record);
      jobs.push({ dir: dir + '/' + label, params, cameras: clip.cameras, record });
    };
    'URFDLB'.split('').forEach((letter, face) => add('face', letter, { face }, shotFor(cond, 'face', rnd, Math.floor(rnd() * 1e9))));
    TWO_SHOT_VIEWS.forEach((view, vi) => add('corner', 'corner-' + vi, { view: { ...view } }, shotFor(cond, 'corner', rnd, Math.floor(rnd() * 1e9))));
    metas.push({ dir, meta: { name, condition: cond, palette, paletteColours: PALETTES[palette], colourNames: PALETTE_NAMES[palette], style, state, shots } });
  }
}

const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const started = Date.now();
let done = 0;
let next = 0;
async function worker(): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 800, height: 1100 } });
  page.on('pageerror', (e) => console.error('page error', e.message));
  const open = async (): Promise<void> => {
    await page.goto('http://' + host + ':' + port + '/tools/synth/render.html');
    await page.waitForFunction('window.synthReady === true', undefined, { timeout: 60000 });
  };
  await open();
  for (;;) {
    const job = jobs[next++];
    if (!job) break;
    mkdirSync(job.dir, { recursive: true });
    const frames: unknown[] = [];
    const CHUNK = 8;
    for (let at = 0; at < job.cameras.length; at += CHUNK) {
      let res: ShotResult[] | null = null;
      for (let attempt = 0; attempt < 6 && !res; attempt++) {
        try {
          // The lamps are set up for the hold position (params.camera) in every chunk.
          res = (await page.evaluate(([p, cams]) => window.renderClip(p as ShotParams, cams as ShotParams['camera'][]), [job.params, job.cameras.slice(at, at + CHUNK)] as const)) as ShotResult[];
        } catch (e) {
          console.error('retrying', job.dir, String(e).slice(0, 80));
          await new Promise((r) => setTimeout(r, 1500));
          await open().catch(() => undefined);
        }
      }
      if (!res) throw new Error('could not render ' + job.dir);
      res.forEach((frame, i) => {
        writeFileSync(job.dir + '/f-' + String(at + i).padStart(3, '0') + '.jpg', Buffer.from(frame.dataUrl.slice(frame.dataUrl.indexOf(',') + 1), 'base64'));
        frames.push(frame.quad || frame.outline);
      });
    }
    job.record.frames = frames;
    done++;
    if (done % 10 === 0) console.log(done + '/' + jobs.length + ' clips', ((Date.now() - started) / 1000).toFixed(0) + 's');
  }
  await page.close();
}
await Promise.all(Array.from({ length: Math.max(1, pagesWanted) }, () => worker()));
await browser.close();
for (const m of metas) writeFileSync(m.dir + '/meta.json', JSON.stringify(m.meta));
writeFileSync(out + '/index.json', JSON.stringify({ seed, per, conditions, fps: FPS, approach: APPROACH, hold: HOLD, cubes: metas.map((m) => m.meta.name) }, null, 1));
console.log('rendered', jobs.length, 'clips of', metas.length, 'cubes in', ((Date.now() - started) / 1000).toFixed(0) + 's ->', out);
