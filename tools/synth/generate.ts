/**
 * Renders the synthetic photo set with headless Chromium.
 *
 *   npx vite --port 5182 --strictPort            (in another shell, from the repo root)
 *   npx tsx tools/synth/generate.ts --out tmp/vision/synth/v1 --per 6 --seed 1 [--only glare,easy] [--pages 4] [--host localhost] [--port 5182]
 *
 * Per cube it writes six face photos (U R F D L B), two corner shots and meta.json with the true
 * state, the true quad corners and every photo parameter. Images stay out of git (tmp/).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { CONDITIONS, PALETTES, PALETTE_NAMES, paletteFor, randomState, shotFor, type Condition } from './conditions';
import { mulberry32, type ShotParams, type ShotResult } from './shot';
import { TWO_SHOT_VIEWS } from '../../src/vision/corner';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const out = arg('out', 'tmp/vision/synth/v1');
const per = Number(arg('per', '6'));
const seed = Number(arg('seed', '1'));
const pagesWanted = Number(arg('pages', '4'));
const only = arg('only', '');
const port = arg('port', '5182');
const host = arg('host', 'localhost');
const conditions = (only ? only.split(',') : [...CONDITIONS]) as Condition[];

interface Job {
  dir: string;
  file: string;
  params: ShotParams;
  record: Record<string, unknown>;
}

const jobs: Job[] = [];
const metas: { dir: string; meta: Record<string, unknown> }[] = [];
let cubeIndex = 0;
for (const cond of conditions) {
  for (let k = 0; k < per; k++) {
    const cubeSeed = seed * 100003 + CONDITIONS.indexOf(cond) * 1009 + k;
    const rnd = mulberry32(cubeSeed);
    const state = randomState(rnd);
    const { palette, style } = paletteFor(cond);
    const name = 'cube-' + String(cubeIndex++).padStart(3, '0') + '-' + cond;
    const dir = out + '/' + name;
    const shots: Record<string, unknown>[] = [];
    'URFDLB'.split('').forEach((letter, face) => {
      const base = shotFor(cond, 'face', rnd, Math.floor(rnd() * 1e9));
      const params: ShotParams = { ...base, state, palette: PALETTES[palette] as string[], style, face };
      const file = letter + (params.post.jpegQuality > 0 ? '.jpg' : '.png');
      const record: Record<string, unknown> = { kind: 'face', face, file, params: { ...params, state: undefined, palette: undefined } };
      shots.push(record);
      jobs.push({ dir, file, params, record });
    });
    TWO_SHOT_VIEWS.forEach((view, vi) => {
      const base = shotFor(cond, 'corner', rnd, Math.floor(rnd() * 1e9));
      const params: ShotParams = { ...base, state, palette: PALETTES[palette] as string[], style, view: { ...view } };
      const file = 'corner-' + vi + (params.post.jpegQuality > 0 ? '.jpg' : '.png');
      const record: Record<string, unknown> = { kind: 'corner', view, file, params: { ...params, state: undefined, palette: undefined } };
      shots.push(record);
      jobs.push({ dir, file, params, record });
    });
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
  await page.goto('http://' + host + ':' + port + '/tools/synth/render.html');
  await page.waitForFunction('window.synthReady === true', undefined, { timeout: 60000 });
  for (;;) {
    const job = jobs[next++];
    if (!job) break;
    let res: ShotResult | null = null;
    for (let attempt = 0; attempt < 8 && !res; attempt++) {
      try {
        res = (await page.evaluate((p) => window.renderShot(p), job.params)) as ShotResult;
      } catch (e) {
        // The dev server reloads the page when a source file changes under it: load it again and retry.
        console.error('retrying', job.file, String(e).slice(0, 80));
        await new Promise((r) => setTimeout(r, 1500));
        await page.goto('http://' + host + ':' + port + '/tools/synth/render.html').catch(() => undefined);
        await page.waitForFunction('window.synthReady === true', undefined, { timeout: 60000 }).catch(() => undefined);
      }
    }
    if (!res) throw new Error('could not render ' + job.dir + '/' + job.file);
    mkdirSync(job.dir, { recursive: true });
    writeFileSync(job.dir + '/' + job.file, Buffer.from(res.dataUrl.slice(res.dataUrl.indexOf(',') + 1), 'base64'));
    if (res.quad) job.record.quad = res.quad;
    if (res.outline) job.record.outline = res.outline;
    done++;
    if (done % 40 === 0) console.log(done + '/' + jobs.length, ((Date.now() - started) / 1000).toFixed(0) + 's');
  }
  await page.close();
}
await Promise.all(Array.from({ length: Math.max(1, pagesWanted) }, () => worker()));
await browser.close();
for (const m of metas) writeFileSync(m.dir + '/meta.json', JSON.stringify(m.meta));
writeFileSync(out + '/index.json', JSON.stringify({ seed, per, conditions, cubes: metas.map((m) => m.meta.name) }, null, 1));
console.log('rendered', jobs.length, 'photos of', metas.length, 'cubes in', ((Date.now() - started) / 1000).toFixed(0) + 's ->', out);
