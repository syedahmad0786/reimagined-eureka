/**
 * Browser checks for the paths the main end-to-end run does not take: live camera capture (with
 * Chromium's fake camera), manual entry, a solved cube, and resuming a saved solve after a reload.
 *
 *   npx tsx scripts/e2e-extra.ts --url http://localhost:5173/ --out tmp/e2e/extra
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const url = arg('url', 'http://localhost:5173/');
const out = resolve(arg('out', 'tmp/e2e/extra'));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['camera'] });
const page = await context.newPage();
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const result: Record<string, unknown> = {};
const counter = async (): Promise<string> => ((await page.textContent('[data-testid=counter]')) ?? '').replace(/\s+/g, ' ').trim();

// Live camera: shutter gives a frame and the outline editor opens.
await page.goto(url);
await page.click('[data-testid=scan]');
await page.waitForSelector('.vz-shutter:not([disabled])', { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, 'camera.png') });
await page.click('.vz-shutter');
await page.waitForSelector('[data-testid=use-photo]');
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 'camera-outline.png') });
result.cameraShutterOpensOutlineEditor = true;

// Manual entry: an empty cube reports unset stickers and cannot be solved.
await page.goto(url);
await page.click('[data-testid=manual]');
await page.waitForSelector('[data-testid=problem]');
result.manualEmptyMessage = await page.textContent('[data-testid=problem] p');
result.manualSolveDisabled = await page.isDisabled('[data-testid=solve]');
await page.click('[data-testid=swatch-2]');
await page.click('.review .grid .cell[data-i="72"]');
result.manualPaintedCell = await page.getAttribute('.review .grid .cell[data-i="72"]', 'data-c');
await page.screenshot({ path: join(out, 'manual.png') });

// A solved cube needs no steps.
await page.goto(url);
await page.click('text=Start from a solved cube');
await page.waitForSelector('[data-testid=valid]');
await page.click('[data-testid=solve]');
await page.waitForSelector('[data-testid=done]', { timeout: 60000 });
result.solvedCube = await counter();

// Resume: solve a random cube, take five steps, reload, resume at step six.
await page.goto(url);
await page.click('[data-testid=demo]');
await page.waitForSelector('[data-testid=valid]');
await page.click('[data-testid=solve]');
await page.waitForSelector('[data-testid=begin]', { timeout: 60000 });
await page.click('[data-testid=begin]');
for (let k = 1; k <= 5; k++) {
  await page.click('[data-testid=next]');
  await page.waitForFunction((n) => document.querySelector('[data-testid=counter]')?.textContent?.replace(/\s+/g, ' ').includes('Step ' + n + ' '), k + 1);
}
const before = await page.evaluate(() => Array.from((window as unknown as { __cubeView: { getState(): Uint8Array } }).__cubeView.getState()));
const notation = await page.textContent('[data-testid=notation]');
await page.reload();
await page.waitForSelector('[data-testid=resume]');
result.resumeLabel = await page.textContent('[data-testid=resume]');
await page.click('[data-testid=resume]');
await page.waitForSelector('[data-testid=notation]', { timeout: 60000 });
await page.waitForTimeout(500);
const after = await page.evaluate(() => Array.from((window as unknown as { __cubeView: { getState(): Uint8Array } }).__cubeView.getState()));
result.resumeCounter = await counter();
result.resumeSameState = JSON.stringify(before) === JSON.stringify(after) && notation === (await page.textContent('[data-testid=notation]'));
await page.screenshot({ path: join(out, 'resumed.png') });

result.consoleErrors = errors;
await browser.close();
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.resumeSameState || errors.length) process.exit(1);
