/**
 * Recognition measured through the real camera path: CameraCapture in Chromium, fed by a fake video
 * device that plays the clips of tools/synth/clips.ts (hand shake, drift, glare that moves).
 *
 *   npx tsx tools/synth/camera-eval.ts --stills tmp/vision/synth/v3 --out tmp/vision/camera-eval/main
 *   npx tsx tools/synth/camera-eval.ts --clips tmp/vision/clips/glare3d --out tmp/vision/camera-eval/glare3d
 *       [--mode face|corner|both] [--throttle 4] [--worker 0] [--cross] [--per 3] [--only glare,clutter]
 *       [--timeout 10000] [--port 5182]
 *
 * --stills takes a photo set (tools/synth/generate.ts) and makes a clip of every photo by moving the
 * camera in the image plane (tools/synth/still-clip.ts). --clips takes rendered or prepared frames
 * (tools/synth/clips.ts, tools/synth/real-clips.ts), in which reflections move as well.
 * For every clip: Chromium is started with --use-file-for-fake-video-capture=<clip>.y4m, the demo page
 * opens the camera in automatic mode (demo/vision.html?live=1), and the script waits for the photo the
 * camera takes by itself. When none comes within the timeout it presses the shutter, as a user would.
 * It records whether and when the capture fired, how far the outline is from the true one, and the
 * sticker samples; a cube is then classified from its six faces (or two corner shots) and compared
 * with the true state, before any correction.
 *   --cross     plays corner clips to 'face' mode and face clips to 'corner' mode: nothing should fire.
 *   --throttle  CPU slowdown of the page's main thread (Chrome DevTools Emulation.setCPUThrottlingRate).
 *   --worker 0  runs the finder on the main thread, so that the slowdown applies to it as well.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';
import { classifyCube } from '../../src/vision/classify';
import { cornerFaces } from '../../src/vision/corner';
import { faceSampleFromRgb } from '../../src/vision/sample';
import type { CornerView } from '../../src/vision/corner';
import type { CornerOutline, FaceSample, ImageLike } from '../../src/vision/types';
import { compare } from '../../tests/vision-eval-lib';
import { readImage } from './node-image';
import { writeStillClip } from './still-clip';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const flag = (name: string): boolean => process.argv.includes('--' + name);
const stills = arg('stills', '');
const clips = stills || arg('clips', 'tmp/vision/clips/c1');
const out = arg('out', 'tmp/vision/camera-eval/main');
const modeArg = arg('mode', 'both');
const throttle = Number(arg('throttle', '1'));
const useWorker = arg('worker', '1') !== '0';
const cross = flag('cross');
const perCondition = Number(arg('per', '99'));
const only = arg('only', '');
/** --cube <name> --shot <label>: one clip only, with the outline and the status history printed. */
const onlyCube = arg('cube', '');
const onlyShot = arg('shot', '');
const timeout = Number(arg('timeout', '10000'));
const port = arg('port', '5182');
mkdirSync(dirname(out), { recursive: true });

interface ShotMeta {
  kind: 'face' | 'corner';
  label: string;
  face?: number;
  view?: CornerView;
  dir: string;
  fps: number;
  approach: number;
  hold: number;
  amplitude: number;
  frames: number[][][];
}
interface CubeMeta {
  name: string;
  condition: string;
  state: number[];
  shots: ShotMeta[];
}
interface RawFace {
  rgb: number[];
  quality: number[];
}
interface LiveResult {
  done: boolean;
  ms: number;
  frame: { mode: string; auto: boolean; source: string; confidence: number; width: number; height: number; points: number[][]; hadSamples: boolean; samples: RawFace[]; single: RawFace[] } | null;
  stats: { frames: number; meanMs: number; maxMs: number; searches: number; meanSearchMs: number; perSecond: number; worker: boolean } | null;
  codes: string[];
  firstSteady: number;
  gaps: { max: number; over50: number; over100: number; n: number; at: number; grabMax: number; grabTotal: number; grabs: number };
}
interface Row {
  cube: string;
  condition: string;
  shot: string;
  mode: string;
  fired: boolean;
  source: string;
  ms: number;
  confidence: number;
  outlineError: number;
  outlineOk: boolean;
  codes: string[];
  /** The last thing the camera asked for before the capture (for clips where it did not fire by itself). */
  lastHint: string;
  /** Side of the face, or width of the silhouette, relative to the shorter side of the frame. */
  size: number;
  stats: LiveResult['stats'];
  gaps: LiveResult['gaps'];
}

const index = JSON.parse(readFileSync(clips + '/index.json', 'utf8')) as { cubes: string[] };
const seen: Record<string, number> = {};
const cubes = index.cubes.filter((name) => {
  const cond = name.replace(/^cube-\d+-/, '');
  if (onlyCube) return name === onlyCube;
  if (only && !only.split(',').includes(cond)) return false;
  seen[cond] = (seen[cond] || 0) + 1;
  return (seen[cond] as number) <= perCondition;
});
const tmpClip = '/tmp/vz-clip-' + process.pid + '.y4m';

async function play(dir: string | null, fps: number, mode: 'face' | 'corner', waitMs: number, pressShutter: boolean): Promise<LiveResult> {
  // dir null: the clip file has been written already.
  if (dir) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', dir + '/f-%03d.jpg', '-pix_fmt', 'yuv420p', tmpClip]);
  const browser = await chromium.launch({
    executablePath: '/usr/local/bin/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + tmpClip],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['camera'] });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('page error', e.message));
    // tsx wraps named functions in a helper that does not exist in the page.
    await page.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await page.addInitScript(() => {
      // Longest time the page went without an animation frame while the camera was live.
      const g = ((window as unknown as { vzGaps: { max: number; over50: number; over100: number; n: number; at: number; grabMax: number; grabTotal: number; grabs: number } }).vzGaps = { max: 0, over50: 0, over100: 0, n: 0, at: 0, grabMax: 0, grabTotal: 0, grabs: 0 });
      // Time the page itself spends copying video frames (drawImage, getImageData): the camera's own work on the main thread.
      for (const name of ['drawImage', 'getImageData'] as const) {
        const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
        const original = proto[name] as (...a: unknown[]) => unknown;
        proto[name] = function (this: unknown, ...a: unknown[]): unknown {
          const t0 = performance.now();
          const r = original.apply(this, a);
          const d = performance.now() - t0;
          g.grabTotal += d;
          g.grabs++;
          g.grabMax = Math.max(g.grabMax, d);
          return r;
        };
      }
      let last = 0;
      const loop = (t: number): void => {
        const live = (window as unknown as { visionLive?: { opened?: number; capturedAt?: number } }).visionLive;
        // Until the photo is handed over: what the demo page does with it afterwards is not the camera's work.
        if (live && live.opened && !live.capturedAt) {
          if (last) {
            const d = t - last;
            g.n++;
            if (d > g.max) g.at = t - (live.opened as number);
            g.max = Math.max(g.max, d);
            if (d > 50) g.over50++;
            if (d > 100) g.over100++;
          }
          last = t;
        } else last = 0;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    if (throttle > 1) {
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    }
    await page.goto('http://localhost:' + port + '/demo/vision.html?live=1&mode=' + mode + (useWorker ? '' : '&worker=0'));
    const read = (): Promise<LiveResult> =>
      page.evaluate(() => {
        const w = window as unknown as { visionLive?: Record<string, unknown>; vzGaps: LiveResult['gaps'] };
        const l = w.visionLive as { done?: boolean; opened?: number; capturedAt: number; frame: LiveResult['frame']; stats: LiveResult['stats']; statuses: { t: number; state: string; code: string }[] } | undefined;
        const codes: string[] = [];
        let firstSteady = -1;
        if (l)
          for (const s of l.statuses) {
            const c = s.state + ':' + s.code;
            if (codes[codes.length - 1] !== c) codes.push(c);
            if (firstSteady < 0 && s.state === 'steady') firstSteady = s.t;
          }
        return { done: !!(l && l.done), ms: l && l.opened ? l.capturedAt - l.opened : -1, frame: l ? l.frame : null, stats: l ? l.stats : null, codes, firstSteady, gaps: w.vzGaps };
      });
    const started = Date.now();
    let res = await read();
    while (!res.done && Date.now() - started < waitMs) {
      await page.waitForTimeout(150);
      res = await read();
    }
    if (!res.done && pressShutter) {
      await page.click('.vz-shutter', { timeout: 5000 }).catch(() => undefined);
      const t1 = Date.now();
      while (!res.done && Date.now() - t1 < 15000) {
        await page.waitForTimeout(150);
        res = await read();
      }
    }
    return res;
  } finally {
    await browser.close();
  }
}

/** Largest distance of an outline point from the true one, in stickers, against the frame of the clip that fits best. */
function outlineError(points: number[][], shot: ShotMeta): number {
  let best = Infinity;
  for (const truth of shot.frames) {
    const side = Math.hypot((truth[1] as number[])[0]! - (truth[0] as number[])[0]!, (truth[1] as number[])[1]! - (truth[0] as number[])[1]!) / 6;
    let e = 0;
    for (let k = 0; k < truth.length; k++) e = Math.max(e, Math.hypot((points[k] as number[])[0]! - (truth[k] as number[])[0]!, (points[k] as number[])[1]! - (truth[k] as number[])[1]!) / side);
    best = Math.min(best, e);
  }
  return best;
}

const rows: Row[] = [];
const cubeRows: { cube: string; condition: string; flow: string; wrongFused: number; wrongSingle: number; autoShots: number; shots: number; badOutlines: number }[] = [];
const toSample = (f: RawFace): FaceSample => faceSampleFromRgb(f.rgb, f.quality);
const started = Date.now();

for (const name of cubes) {
  const meta = JSON.parse(readFileSync(clips + '/' + name + '/meta.json', 'utf8')) as CubeMeta;
  if (stills)
    for (const shot of meta.shots as (ShotMeta & { file: string; quad?: number[][]; outline?: number[][] })[]) shot.label = shot.kind === 'face' ? 'URFDLB'[shot.face as number] as string : shot.file.replace(/\.\w+$/, '');
  for (const kind of ['face', 'corner'] as const) {
    if (modeArg !== 'both' && modeArg !== kind) continue;
    const shots = meta.shots.filter((s) => s.kind === kind);
    const mode = cross ? (kind === 'face' ? 'corner' : 'face') : kind;
    const fused: (FaceSample | null)[] = [null, null, null, null, null, null];
    const single: (FaceSample | null)[] = [null, null, null, null, null, null];
    let autoShots = 0;
    let badOutlines = 0;
    for (const shot of shots) {
      if (onlyShot && shot.label !== onlyShot) continue;
      if (stills) {
        const still = shot as ShotMeta & { file: string; quad?: number[][]; outline?: number[][] };
        const truth = (still.quad || still.outline) as number[][];
        const sticker = Math.hypot((truth[1] as number[])[0]! - (truth[0] as number[])[0]!, (truth[1] as number[])[1]! - (truth[0] as number[])[1]!) / 6;
        let seed = 17;
        for (const ch of name + still.file) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
        const clip = writeStillClip(readImage(clips + '/' + name + '/' + still.file), truth, sticker, seed, tmpClip);
        shot.frames = clip.frames;
        shot.fps = clip.fps;
        shot.amplitude = clip.amplitude;
      }
      const res = await play(stills ? null : clips + '/' + name + '/' + shot.dir, shot.fps, mode, timeout, !cross);
      const f = res.frame;
      const fired = !!f && f.auto;
      const err = f && !cross ? outlineError(f.points, shot) : NaN;
      const lastHint = (res.codes.filter((c) => !c.startsWith('captured') && !c.startsWith('starting')).pop() || 'none').replace(/^\w+:/, '');
      const last = shot.frames[shot.frames.length - 1] as number[][];
      const xs = last.map((p) => p[0] as number);
      const size = (kind === 'face' ? Math.hypot((last[1] as number[])[0]! - (last[0] as number[])[0]!, (last[1] as number[])[1]! - (last[0] as number[])[1]!) : Math.max(...xs) - Math.min(...xs)) / (f ? Math.min(f.width, f.height) : 750);
      const row: Row = { cube: name, condition: meta.condition, shot: shot.label, mode, fired, source: f ? f.source : 'none', ms: fired ? Math.round(res.ms) : -1, confidence: f ? f.confidence : 0, outlineError: err, outlineOk: err < 0.25, codes: res.codes, lastHint, size, stats: res.stats, gaps: res.gaps };
      rows.push(row);
      console.log([name, shot.label, mode, fired ? 'auto ' + row.ms + ' ms' : row.source, 'conf ' + row.confidence.toFixed(2), 'err ' + (Number.isNaN(err) ? '-' : err.toFixed(2)), res.stats ? res.stats.perSecond.toFixed(1) + '/s' : '', 'gap ' + Math.round(res.gaps.max)].join(' | '));
      if (onlyCube && f) {
        let bestN = 0;
        let bestE = Infinity;
        shot.frames.forEach((truth, n) => {
          const e = Math.max(...truth.map((t, k) => Math.hypot((f.points[k] as number[])[0]! - (t[0] as number), (f.points[k] as number[])[1]! - (t[1] as number))));
          if (e < bestE) [bestE, bestN] = [e, n];
        });
        console.log('  points ' + JSON.stringify(f.points.map((p) => p.map((v) => Math.round(v)))) + '\n  nearest true frame ' + bestN + ' ' + JSON.stringify((shot.frames[bestN] as number[][]).map((p) => p.map((v) => Math.round(v)))) + '\n  ' + res.codes.join(' > ') + '\n  first steady at ' + Math.round(res.firstSteady) + ' ms; longest gap ' + Math.round(res.gaps.max) + ' ms at ' + Math.round(res.gaps.at) + ' ms, over 50 ms: ' + res.gaps.over50 + ' of ' + res.gaps.n + '; frame copies ' + res.gaps.grabs + ', total ' + Math.round(res.gaps.grabTotal) + ' ms, longest ' + Math.round(res.gaps.grabMax) + ' ms; ' + JSON.stringify(res.stats));
      }
      if (cross || !f) continue;
      if (fired) autoShots++;
      if (!row.outlineOk) badOutlines++;
      if (kind === 'face') {
        fused[shot.face as number] = toSample(f.samples[0] as RawFace);
        single[shot.face as number] = toSample(f.single[0] as RawFace);
      } else {
        const outline = f.points.map((p) => ({ x: p[0] as number, y: p[1] as number })) as CornerOutline;
        const none: ImageLike = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
        for (const cf of cornerFaces(none, outline, shot.view as CornerView, f.samples.map(toSample))) fused[cf.face] = cf.sample;
        for (const cf of cornerFaces(none, outline, shot.view as CornerView, f.single.map(toSample))) single[cf.face] = cf.sample;
      }
    }
    if (!cross && fused.every(Boolean)) {
      const wrongFused = compare(classifyCube(fused as FaceSample[]), meta.state).wrong.length;
      const wrongSingle = compare(classifyCube(single as FaceSample[]), meta.state).wrong.length;
      cubeRows.push({ cube: name, condition: meta.condition, flow: kind, wrongFused, wrongSingle, autoShots, shots: shots.length, badOutlines });
      console.log('  => ' + name + ' ' + kind + ' flow: wrong ' + wrongFused + ' of 216 (single frame: ' + wrongSingle + '), automatic ' + autoShots + '/' + shots.length + ', bad outlines ' + badOutlines + '  [' + ((Date.now() - started) / 1000).toFixed(0) + 's]');
    }
    writeFileSync(out + '.json', JSON.stringify({ clips, throttle, worker: useWorker, cross, timeout, rows, cubes: cubeRows }, null, 1));
  }
}
rmSync(tmpClip, { force: true });

// ---- summary ----
const med = (v: number[]): number => (v.length ? (v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)] as number) : NaN);
const q = (v: number[], p: number): number => (v.length ? (v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))] as number) : NaN);
const lines: string[] = [];
lines.push('clips: ' + clips + '; CPU slowdown: ' + throttle + 'x; finder in a worker: ' + useWorker + '; cross-mode test: ' + cross + '; timeout: ' + timeout + ' ms');
for (const mode of ['face', 'corner']) {
  const r = rows.filter((x) => x.mode === mode);
  if (!r.length) continue;
  const fired = r.filter((x) => x.fired);
  const times = fired.map((x) => x.ms);
  lines.push('');
  lines.push(mode + ' mode: ' + r.length + ' clips');
  lines.push('  automatic capture fired: ' + fired.length + ' of ' + r.length + ' (' + ((100 * fired.length) / r.length).toFixed(1) + '%)');
  if (fired.length) lines.push('  time from camera open to capture: median ' + med(times) + ' ms, 90% within ' + q(times, 0.9) + ' ms, longest ' + Math.max(...times) + ' ms');
  if (!cross) {
    lines.push('  automatic captures on a wrong outline (more than a quarter sticker off): ' + fired.filter((x) => !x.outlineOk).length + ' of ' + fired.length);
    const manual = r.filter((x) => !x.fired);
    lines.push('  not fired, shutter pressed instead: ' + manual.length + ', of which outline right: ' + manual.filter((x) => x.outlineOk).length);
    const why: Record<string, number> = {};
    for (const x of manual) why[x.lastHint] = (why[x.lastHint] || 0) + 1;
    if (manual.length) lines.push('    what the camera was asking for when it did not fire: ' + Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', '));
    lines.push('  outline error of automatic captures, in stickers: median ' + med(fired.map((x) => x.outlineError)).toFixed(3) + ', largest ' + Math.max(0, ...fired.map((x) => x.outlineError)).toFixed(3));
    lines.push('  automatic captures with confidence below 0.9: ' + fired.filter((x) => x.confidence < 0.9).length);
  }
  const st = r.map((x) => x.stats).filter(Boolean) as NonNullable<Row['stats']>[];
  if (st.length) lines.push('  finder: median ' + med(st.map((s) => s.perSecond)).toFixed(1) + ' frames a second (slowest clip ' + Math.min(...st.map((s) => s.perSecond)).toFixed(1) + '), median time per frame ' + med(st.map((s) => s.meanMs)).toFixed(0) + ' ms, per fresh search ' + med(st.filter((s) => s.searches).map((s) => s.meanSearchMs)).toFixed(0) + ' ms, longest single frame ' + Math.max(...st.map((s) => s.maxMs)).toFixed(0) + ' ms');
  lines.push('  page: time spent copying video frames on the main thread, per clip: median ' + med(r.map((x) => x.gaps.grabTotal)).toFixed(0) + ' ms in total, longest single copy ' + Math.max(...r.map((x) => x.gaps.grabMax)).toFixed(0) + ' ms (median over clips ' + med(r.map((x) => x.gaps.grabMax)).toFixed(0) + ' ms)');
  lines.push('  page: animation frames more than 50 ms apart, share of all frames: ' + ((100 * r.reduce((a, x) => a + x.gaps.over50, 0)) / Math.max(1, r.reduce((a, x) => a + x.gaps.n, 0))).toFixed(1) + '%');
  lines.push('  page: longest gap between animation frames, median over clips ' + med(r.map((x) => x.gaps.max)).toFixed(0) + ' ms, worst ' + Math.max(...r.map((x) => x.gaps.max)).toFixed(0) + ' ms; clips with a gap over 100 ms: ' + r.filter((x) => x.gaps.over100 > 0).length);
  const by: Record<string, Row[]> = {};
  for (const x of r) (by[x.condition] ??= []).push(x);
  if (cross) {
    const seenHints: Record<string, number> = {};
    for (const x of r) seenHints[x.lastHint] = (seenHints[x.lastHint] || 0) + 1;
    lines.push('  last hint shown: ' + Object.entries(seenHints).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', '));
  }
  for (const [cond, list] of Object.entries(by)) lines.push('    ' + cond.padEnd(16) + ' fired ' + list.filter((x) => x.fired).length + '/' + list.length + (cross ? '' : ', wrong outline among fired ' + list.filter((x) => x.fired && !x.outlineOk).length + ', median ' + med(list.filter((x) => x.fired).map((x) => x.ms)) + ' ms'));
}
for (const flow of ['face', 'corner']) {
  const c = cubeRows.filter((x) => x.flow === flow);
  if (!c.length) continue;
  const sum = (f: (x: (typeof c)[number]) => number): number => c.reduce((a, x) => a + f(x), 0);
  lines.push('');
  lines.push((flow === 'face' ? 'six-photo flow' : 'quick scan (two corner shots)') + ': ' + c.length + ' cubes');
  lines.push('  stickers read correctly before any correction: ' + (100 - (100 * sum((x) => x.wrongFused)) / (216 * c.length)).toFixed(3) + '% (' + sum((x) => x.wrongFused) + ' wrong of ' + 216 * c.length + ')');
  lines.push('  the same from the single returned photo, without merging frames: ' + (100 - (100 * sum((x) => x.wrongSingle)) / (216 * c.length)).toFixed(3) + '% (' + sum((x) => x.wrongSingle) + ' wrong)');
  lines.push('  cubes with 0 wrong / 1 to 3 / more: ' + c.filter((x) => x.wrongFused === 0).length + ' / ' + c.filter((x) => x.wrongFused > 0 && x.wrongFused <= 3).length + ' / ' + c.filter((x) => x.wrongFused > 3).length + ', worst ' + Math.max(...c.map((x) => x.wrongFused)));
  const by: Record<string, typeof c> = {};
  for (const x of c) (by[x.condition] ??= []).push(x);
  for (const [cond, list] of Object.entries(by)) lines.push('    ' + cond.padEnd(16) + ' wrong ' + list.reduce((a, x) => a + x.wrongFused, 0) + ' of ' + 216 * list.length + ' (single frame ' + list.reduce((a, x) => a + x.wrongSingle, 0) + '), automatic ' + list.reduce((a, x) => a + x.autoShots, 0) + '/' + list.reduce((a, x) => a + x.shots, 0));
}
writeFileSync(out + '.txt', lines.join('\n') + '\n');
console.log('\n' + lines.join('\n'));
