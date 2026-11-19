/**
 * Saves screenshots of the viewer demo page for a list of moves, for looking at by eye.
 *   npx tsx tools/viewer/shots.ts [--url http://localhost:5181] [--out tmp/viewer-shots] [--scramble] R "L'" U2 ...
 * Needs a dev server (npx vite --port 5181 --strictPort) and the system Chromium.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const take = (flag: string, fallback: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? fallback : (args.splice(i, 2)[1] as string);
};
const url = take('--url', 'http://localhost:5181');
const query = take('--query', '');
const out = take('--out', 'tmp/viewer-shots');
const scrambleAt = args.indexOf('--scramble');
if (scrambleAt >= 0) args.splice(scrambleAt, 1);
const moves = args.length ? args : ['R', "L'", 'U2', '3Rw', "2-3Lw'", '3F', '2D2', 'B', "3Dw'"];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/local/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
mkdirSync(out, { recursive: true });
for (const { name, ...viewport } of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url + '/demo/viewer.html?seed=5' + (query ? '&' + query : ''));
  await page.waitForFunction('window.__view');
  for (const text of moves) {
    await page.evaluate(
      ([text, scramble]) => {
        const w = window as any;
        const c = w.__cube;
        const state = scramble ? c.applyMoves(c.solvedState(), c.randomMoves(80, c.makeRng(11))) : c.solvedState();
        w.__view.setState(state, w.__palette);
        w.__view.showMove(c.parseMove(text));
        document.getElementById('move')!.textContent = text;
      },
      [text, scrambleAt >= 0] as const,
    );
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = join(out, name + '-' + text.replace("'", 'prime') + (scrambleAt >= 0 ? '-scrambled' : '') + '.png');
    await page.screenshot({ path: file });
    console.log(file);
  }
  await context.close();
}
await browser.close();
