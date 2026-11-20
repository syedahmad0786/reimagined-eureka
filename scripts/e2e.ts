/**
 * Drives the whole app in headless Chromium: load six photos, accept the outlines, check the scan
 * against the truth, correct stickers, solve, press Next to the end and confirm the 3D cube is solved.
 *
 *   npx tsx scripts/e2e.ts --url http://localhost:5173/ --cube tmp/vision/synth/v3/cube-000-easy --view phone --out tmp/e2e/phone
 *
 * The cube directory holds U R F D L B as .jpg or .png and meta.json with the true state
 * (written by tools/synth/generate.ts). Screenshots, a video and result.json go to --out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const url = arg('url', 'http://localhost:5173/');
const cubeDir = resolve(arg('cube', 'tmp/vision/synth/v3/cube-000-easy'));
const viewName = arg('view', 'phone');
const out = resolve(arg('out', 'tmp/e2e/' + viewName));
const video = arg('video', '1') === '1';
mkdirSync(out, { recursive: true });

const phone = viewName === 'phone';
const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const truth = (JSON.parse(readFileSync(join(cubeDir, 'meta.json'), 'utf8')) as { state: number[] }).state;
const ORDER = ['F', 'R', 'B', 'L', 'U', 'D'];
const FACE_IDS = [2, 1, 5, 4, 0, 3];

const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const context = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone, recordVideo: video ? { dir: out, size: viewport } : undefined });
const page = await context.newPage();
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
let shot = 0;
const snap = async (name: string): Promise<void> => {
  shot++;
  await page.screenshot({ path: join(out, String(shot).padStart(2, '0') + '-' + name + '.png') });
};

await page.goto(url);
await page.waitForSelector('[data-testid=scan]');
await snap('home');

// 1. Six photos, in capture order.
await page.setInputFiles('[data-testid=files]', ORDER.map((f) => [join(cubeDir, f + '.jpg'), join(cubeDir, f + '.png')].find(existsSync) as string));
for (let i = 0; i < 6; i++) {
  await page.waitForSelector('[data-testid=use-photo]');
  await page.waitForTimeout(i === 0 ? 1200 : 700);
  if (i === 0 || i === 4) await snap('outline-' + ORDER[i]);
  await page.click('[data-testid=use-photo]');
}

// 2. Read the scanned state back from the correction grids.
await page.waitForSelector('.review .grid');
await snap('scan-result');
const readState = async (): Promise<number[]> => {
  const state = new Array<number>(216).fill(255);
  for (const f of FACE_IDS) {
    await page.click('[data-testid=face-' + f + ']');
    const cells = await page.$$eval('.review .grid .cell', (els) => els.map((e) => [Number((e as HTMLElement).dataset.i), Number((e as HTMLElement).dataset.c)]));
    for (const [i, c] of cells) state[i as number] = c as number;
  }
  return state;
};
const scanned = await readState();
// Colour ids are arbitrary: map each true colour to the scanned id it most often became.
const votes = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
for (let i = 0; i < 216; i++) (votes[truth[i] as number] as number[])[scanned[i] as number]!++;
const map = votes.map((v) => v.indexOf(Math.max(...v)));
const wrong: number[] = [];
for (let i = 0; i < 216; i++) if (map[truth[i] as number] !== scanned[i]) wrong.push(i);
const validBefore = (await page.$('[data-testid=valid]')) !== null;
const problemsBefore = await page.$$eval('[data-testid=problem] p', (els) => els.map((e) => e.textContent));

const paint = async (i: number, colour: number): Promise<void> => {
  await page.click('[data-testid=face-' + Math.floor(i / 36) + ']');
  await page.click('[data-testid=swatch-' + colour + ']');
  await page.click('.review .grid .cell[data-i="' + i + '"]');
};

// 3. Correct what the scan got wrong.
for (const i of wrong) await paint(i, map[truth[i] as number] as number);
await page.waitForSelector('[data-testid=valid]');

// 4. Break one sticker on purpose, see the named problem, and repair it.
const victim = 2 * 36 + 2 * 6 + 3;
const right = map[truth[victim] as number] as number;
await paint(victim, (right + 1) % 6);
await page.waitForSelector('[data-testid=problem]');
const problemsBroken = await page.$$eval('[data-testid=problem] p', (els) => els.map((e) => e.textContent));
let suggestion: string | null = null;
try {
  await page.waitForSelector('[data-testid=suggestion]', { timeout: 30000 });
  suggestion = await page.$eval('[data-testid=suggestion] p', (e) => e.textContent);
} catch {
  // no suggestion in time: repaint by hand below
}
await page.evaluate(() => window.scrollTo(0, 0));
await snap('wrong-sticker');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await snap('wrong-sticker-messages');
await paint(victim, right);
await page.waitForSelector('[data-testid=valid]');
await page.evaluate(() => window.scrollTo(0, 0));
await snap('corrected');

// 5. Solve.
const t0 = Date.now();
await page.click('[data-testid=solve]');
await page.waitForSelector('[data-testid=begin]', { timeout: 120000 });
const solveMs = Date.now() - t0;
await page.waitForTimeout(900);
await snap('hold-instruction');
await page.click('[data-testid=begin]');
await page.waitForTimeout(400);
await snap('step-1');
const counter = async (): Promise<string> => ((await page.textContent('[data-testid=counter]')) ?? '').replace(/\s+/g, ' ').trim();
const total = Number((await counter()).match(/of (\d+)/)?.[1]);
const notations: string[] = [];
const phases: string[] = [];
const startState = await page.evaluate(() => Array.from((window as unknown as { __cubeView: { getState(): Uint8Array } }).__cubeView.getState()));

// Controls: show turn, next, back, jump to start.
await page.click('[data-testid=replay]');
await page.waitForTimeout(2200);
await page.click('[data-testid=next]');
await page.waitForFunction(() => document.querySelector('[data-testid=counter]')?.textContent?.includes('Step 2 '));
await page.click('[data-testid=next]');
await page.waitForFunction(() => document.querySelector('[data-testid=counter]')?.textContent?.includes('Step 3 '));
await page.click('[data-testid=back]');
await page.waitForFunction(() => document.querySelector('[data-testid=counter]')?.textContent?.includes('Step 2 '));
await page.click('[data-testid=start]');
await page.waitForFunction(() => document.querySelector('[data-testid=counter]')?.textContent?.includes('Step 1 '));
const backAtStart = await page.evaluate(() => Array.from((window as unknown as { __cubeView: { getState(): Uint8Array } }).__cubeView.getState()));
const controlsOk = JSON.stringify(backAtStart) === JSON.stringify(startState);

// Auto-play a few steps, then pause.
await page.click('[data-testid=speed]');
await page.click('[data-testid=auto]');
await page.waitForFunction(() => document.querySelector('[data-testid=counter]')?.textContent?.includes('Step 4 '), null, { timeout: 60000 });
await page.click('[data-testid=auto]');
await page.waitForTimeout(800);
const afterAuto = Number((await counter()).match(/Step (\d+)/)?.[1]);

// 6. Next, one step at a time, to the end.
const seenPhases = new Set<string>();
for (let k = afterAuto; k <= total; k++) {
  notations.push((await page.textContent('[data-testid=notation]')) ?? '');
  const phase = (await page.textContent('[data-testid=phase]')) ?? '';
  phases.push(phase);
  if (!seenPhases.has(phase)) {
    seenPhases.add(phase);
    await snap('phase-' + phase.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  }
  await page.click('[data-testid=next]');
  if (k < total) await page.waitForFunction((n) => document.querySelector('[data-testid=counter]')?.textContent?.replace(/\s+/g, ' ').includes('Step ' + n + ' '), k + 1, { timeout: 30000 });
}
await page.waitForSelector('[data-testid=done]', { timeout: 30000 });
await page.waitForTimeout(600);
await snap('solved');
const finalState = await page.evaluate(() => Array.from((window as unknown as { __cubeView: { getState(): Uint8Array } }).__cubeView.getState()));
let solved = true;
for (let f = 0; f < 6; f++) for (let i = 1; i < 36; i++) if (finalState[f * 36 + i] !== finalState[f * 36]) solved = false;
const doneText = await page.textContent('[data-testid=done]');
const phaseLabel = await page.textContent('[data-testid=phase]');

await context.close();
await browser.close();
if (video) {
  const file = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'run.webm');
  if (file) renameSync(join(out, file), join(out, 'run.webm'));
}
const result = {
  view: viewName,
  viewport,
  cube: cubeDir.split('/').slice(-1)[0],
  scan: { wrongStickersBeforeCorrection: wrong.length, of: 216, validBeforeCorrection: validBefore, problemsBeforeCorrection: problemsBefore },
  deliberateError: { problems: problemsBroken, suggestion },
  solve: { steps: total, clickToFirstStepMs: solveMs, phases: Array.from(seenPhases) },
  controlsOk,
  cubeViewSolvedAtEnd: solved,
  doneText,
  phaseLabel,
  consoleErrors: errors,
};
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!solved || !controlsOk || errors.length) process.exit(1);
