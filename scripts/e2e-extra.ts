/**
 * Browser checks for the paths the main end-to-end run does not take: the live camera (with
 * Chromium's fake camera, which shows no cube), no camera at all, manual entry, a solved cube,
 * reload at every stage, the Learn layer, the note at a phase change, the celebration, reduced
 * motion and, on a built copy, working with no network.
 *
 *   npx tsx scripts/e2e-extra.ts --url http://localhost:5173/ --out tmp/e2e/extra [--offline 1]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const url = arg('url', 'http://localhost:5173/');
const out = resolve(arg('out', 'tmp/e2e/extra'));
const offline = arg('offline', '0') === '1';
mkdirSync(out, { recursive: true });

const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const errors: string[] = [];
const watch = (page: Page): void => {
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
};
const result: Record<string, unknown> = {};
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  result[name] = ok;
  if (!ok) failures.push(name);
};
type View = { getState(): Uint8Array; debug(): { camera: { x: number; z: number } } };
const cubeState = (page: Page): Promise<number[]> => page.evaluate(() => Array.from((window as unknown as { __cubeView: View }).__cubeView.getState()));
const counter = async (page: Page): Promise<string> => ((await page.textContent('[data-testid=counter]')) ?? '').replace(/\s+/g, ' ').trim();
const waitStep = (page: Page, n: number): Promise<unknown> =>
  page.waitForFunction((k) => document.querySelector('[data-testid=counter]')?.textContent?.replace(/\s+/g, ' ').includes('Step ' + k + ' '), n, { timeout: 30000 });
const scrubTo = (page: Page, k: number): Promise<void> =>
  page.evaluate((v) => {
    const el = document.querySelector('.scrub') as HTMLInputElement;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, k);
/** Open the app as a first-time visitor: nothing saved, so it starts on the home screen. */
const fresh = async (page: Page): Promise<void> => {
  await page.goto(url);
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        localStorage.clear();
        const request = indexedDB.deleteDatabase('cube6');
        request.onsuccess = request.onerror = request.onblocked = () => done();
      }),
  );
  await page.goto(url);
  await page.waitForSelector('[data-testid=scan]');
};
const toSolve = async (page: Page): Promise<number> => {
  await fresh(page);
  await page.click('[data-testid=demo]');
  await page.waitForSelector('[data-testid=valid]');
  await page.click('[data-testid=solve]');
  await page.waitForSelector('[data-testid=begin]', { timeout: 60000 });
  await page.click('[data-testid=begin]');
  await page.waitForSelector('[data-testid=notation]');
  return Number((await counter(page)).match(/of (\d+)/)?.[1]);
};

// ---- Fake camera: a picture with no cube in it. The shutter still works and nothing is taken by itself.
{
  const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: [...GL, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ ...PHONE, permissions: ['camera'] });
  const page = await context.newPage();
  watch(page);
  await page.goto(url);
  await page.click('[data-testid=scan]');
  await page.waitForSelector('.vz-shutter:not([disabled])', { timeout: 20000 });
  await page.waitForTimeout(3500);
  result.cameraStatus = await page.textContent('[data-testid=cam-status]').catch(() => null);
  check('cameraDoesNotFireWithoutACube', (await page.$('[data-testid=use-photo]')) === null);
  await page.screenshot({ path: join(out, 'camera.png') });
  await page.click('.vz-shutter');
  await page.waitForSelector('[data-testid=use-photo]', { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, 'camera-after-shutter.png') });
  check('shutterGivesAPhotoToCheck', true);
  check('unsureOutlineShowsGrips', (await page.$('[data-testid=unsure]')) !== null);
  // Reload in the middle of a scan: the same photo number comes back.
  await page.click('[data-testid=use-photo]');
  await page.waitForSelector('.vz-shutter:not([disabled])', { timeout: 20000 });
  await page.reload();
  await page.waitForSelector('.vz-shutter:not([disabled])', { timeout: 20000 });
  check('reloadDuringScanKeepsPhotoNumber', ((await page.textContent('.bar-title')) ?? '').includes('Photo 2 of 6'));
  await browser.close();
}

// ---- No camera (and no permission): the screen says so and offers the photo picker.
{
  const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: GL });
  const page = await (await browser.newContext(PHONE)).newPage();
  watch(page);
  await page.goto(url);
  await page.click('[data-testid=scan]');
  await page.waitForSelector('.vz-camera.vz-nocam .vz-file input', { state: 'attached', timeout: 20000 });
  await page.waitForTimeout(1500);
  result.noCameraNote = ((await page.textContent('.vz-note').catch(() => '')) ?? '').trim();
  check('noCameraOffersPhotoPicker', (result.noCameraNote as string).length > 0);
  await page.screenshot({ path: join(out, 'no-camera.png') });
  await browser.close();
}

const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: GL });
const context = await browser.newContext(PHONE);
const page = await context.newPage();
watch(page);

// ---- Manual entry: an empty cube reports unset stickers and cannot be solved.
await fresh(page);
await page.click('[data-testid=manual]');
await page.waitForSelector('[data-testid=problem]');
result.manualEmptyMessage = await page.textContent('[data-testid=problem] p');
check('manualSolveDisabled', await page.isDisabled('[data-testid=solve]'));
await page.click('[data-testid=swatch-2]');
await page.click('.review .grid .cell[data-i="72"]');
check('manualPaintedCell', (await page.getAttribute('.review .grid .cell[data-i="72"]', 'data-c')) === '2');
await page.screenshot({ path: join(out, 'manual.png') });
// Reload while checking colours: the painted sticker is still there.
await page.reload();
await page.waitForSelector('.review .grid');
check('reloadDuringCheckKeepsColours', (await page.getAttribute('.review .grid .cell[data-i="72"]', 'data-c')) === '2');

// ---- A solved cube needs no steps, and gets no celebration.
await fresh(page);
await page.click('text=Start from a solved cube');
await page.waitForSelector('[data-testid=valid]');
await page.click('[data-testid=solve]');
await page.waitForSelector('[data-testid=done]', { timeout: 60000 });
result.solvedCube = await counter(page);
check('solvedCubeHasNoConfetti', (await page.$('canvas.confetti')) === null);

// ---- Learn: from the home screen, a topic, an algorithm played on a cube.
await fresh(page);
await page.click('[data-testid=learn]');
await page.waitForSelector('[data-testid=learn-layer]');
result.learnTopics = await page.$$eval('.topic b', (els) => els.map((e) => e.textContent));
await page.screenshot({ path: join(out, 'learn.png') });
await page.click('[data-testid=open-parity]');
await page.waitForSelector('[data-testid=topic-parity]');
await page.click('[data-testid=alg-swap-parity] [data-testid=alg-show]');
await page.waitForSelector('[data-testid=alg-swap-parity] canvas');
const algMoves = await page.$$eval('[data-testid=alg-swap-parity] .alg-moves code', (els) => els.length);
for (let k = 0; k < algMoves; k++) {
  await page.click('[data-testid=alg-swap-parity] [data-testid=alg-step]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=alg-swap-parity] .alg-moves code.done').length === n, k + 1, { timeout: 15000 });
}
await page.locator('[data-testid=alg-swap-parity]').scrollIntoViewIfNeeded();
await page.screenshot({ path: join(out, 'learn-algorithm.png') });
check('learnAlgorithmPlaysToTheEnd', await page.isDisabled('[data-testid=alg-swap-parity] [data-testid=alg-step]'));
await page.click('[data-testid=learn-close]');
check('learnCloses', (await page.$('[data-testid=learn-layer]')) === null);

// ---- Solve: five steps, Learn on top without losing the place, reload, carry on.
const total = await toSolve(page);
for (let k = 1; k <= 5; k++) {
  await page.click('[data-testid=next]');
  await waitStep(page, k + 1);
}
const before = await cubeState(page);
const notation = await page.textContent('[data-testid=notation]');
await page.click('.solve [data-testid=learn]');
await page.waitForSelector('[data-testid=learn-layer]');
result.learnFromSolveOpens = await page.textContent('[data-testid=learn-layer] h1');
await page.click('[data-testid=learn-close]');
check('learnKeepsTheSolveInPlace', (await counter(page)).includes('Step 6 ') && JSON.stringify(await cubeState(page)) === JSON.stringify(before));
await page.reload();
await page.waitForSelector('[data-testid=notation]', { timeout: 60000 });
await page.waitForTimeout(500);
result.reloadCounter = await counter(page);
check('reloadDuringSolveKeepsStepAndCube', JSON.stringify(before) === JSON.stringify(await cubeState(page)) && notation === (await page.textContent('[data-testid=notation]')));
await page.screenshot({ path: join(out, 'reloaded.png') });
// Leaving and coming back through the home screen.
await page.click('[data-testid=exit]');
await page.click('.review .bar .btn');
await page.waitForSelector('[data-testid=resume]');
result.resumeLabel = ((await page.textContent('[data-testid=resume]')) ?? '').replace(/\s+/g, ' ').trim();
await page.screenshot({ path: join(out, 'home-resume.png') });
await page.click('[data-testid=resume]');
await page.waitForSelector('[data-testid=notation]', { timeout: 60000 });
await page.waitForTimeout(500);
check('resumeFromHomeKeepsStepAndCube', JSON.stringify(before) === JSON.stringify(await cubeState(page)));

// ---- A new phase starts with a note. Find where edge pairing starts, reload just before it, step in.
let lo = 0;
let hi = total - 1;
while (lo < hi) {
  const mid = (lo + hi) >> 1;
  await scrubTo(page, mid);
  if (((await page.textContent('[data-testid=phase]')) ?? '') === 'Centres') lo = mid + 1;
  else hi = mid;
}
await scrubTo(page, lo - 1);
await page.reload();
await page.waitForSelector('[data-testid=notation]', { timeout: 60000 });
await page.click('[data-testid=next]');
await page.waitForSelector('[data-testid=phase-note]', { timeout: 15000 });
result.phaseNote = ((await page.textContent('[data-testid=phase-note]')) ?? '').slice(0, 160);
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, 'phase-note.png') });
await page.click('[data-testid=next]');
await page.waitForSelector('[data-testid=notation]');
check('phaseNoteThenSameStep', (await counter(page)).includes('Step ' + (lo + 1) + ' '));

// ---- The last step: celebration with his numbers, then "solve another".
await scrubTo(page, total - 1);
await page.click('[data-testid=next]');
await page.waitForSelector('[data-testid=again]', { timeout: 15000 });
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, 'solved-confetti.png') });
check('celebrationShowsSteps', (await page.textContent('[data-testid=stat-steps]')) === String(total));
result.celebrationTime = await page.textContent('[data-testid=stat-time]');
const spinA = await page.evaluate(() => (window as unknown as { __cubeView: View }).__cubeView.debug().camera.x);
await page.waitForTimeout(600);
const spinB = await page.evaluate(() => (window as unknown as { __cubeView: View }).__cubeView.debug().camera.x);
check('solvedCubeSpins', spinA !== spinB);
const final = await cubeState(page);
check('cubeIsSolved', [0, 1, 2, 3, 4, 5].every((f) => final.slice(f * 36, f * 36 + 36).every((c) => c === final[f * 36])));
await page.click('[data-testid=again]');
await page.waitForSelector('[data-testid=scan]');
check('solveAnotherGoesHomeWithNothingSaved', (await page.$('[data-testid=resume]')) === null);

// ---- Offline (built copy only): after one visit the app opens and solves with the network off.
if (offline) {
  await fresh(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-testid=scan]', { timeout: 20000 });
  await page.click('[data-testid=demo]');
  await page.waitForSelector('[data-testid=valid]');
  await page.click('[data-testid=solve]');
  await page.waitForSelector('[data-testid=begin]', { timeout: 60000 });
  await page.screenshot({ path: join(out, 'offline.png') });
  check('worksOffline', true);
  result.manifest = await page.evaluate(() => (document.querySelector('link[rel=manifest]') as HTMLLinkElement | null)?.href ?? null);
  await context.setOffline(false);
}
await browser.close();

// ---- Reduced motion: no spinning, confetti drawn once and left still, turns applied at once.
{
  const quiet = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: GL });
  const calm = await (await quiet.newContext({ ...PHONE, reducedMotion: 'reduce' })).newPage();
  watch(calm);
  const n = await toSolve(calm);
  await scrubTo(calm, n - 1);
  await calm.click('[data-testid=next]');
  await calm.waitForSelector('[data-testid=again]', { timeout: 15000 });
  const picture = (): Promise<string> => calm.evaluate(() => (document.querySelector('canvas.confetti') as HTMLCanvasElement).toDataURL().slice(-4000));
  const a = await picture();
  const camA = await calm.evaluate(() => (window as unknown as { __cubeView: View }).__cubeView.debug().camera.x);
  await calm.waitForTimeout(700);
  check('reducedMotionConfettiIsStill', a === (await picture()) && a.length > 100);
  check('reducedMotionCubeDoesNotSpin', camA === (await calm.evaluate(() => (window as unknown as { __cubeView: View }).__cubeView.debug().camera.x)));
  await calm.screenshot({ path: join(out, 'solved-reduced-motion.png') });
  await quiet.close();
}

result.consoleErrors = errors;
result.failures = failures;
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failures.length || errors.length) process.exit(1);
