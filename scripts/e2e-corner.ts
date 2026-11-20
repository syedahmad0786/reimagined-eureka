/**
 * Quick scan in headless Chromium: two corner photos in, automatic outlines accepted as they are,
 * scanned state compared with the truth.
 *
 *   npx tsx scripts/e2e-corner.ts --url http://localhost:5173/ --out tmp/e2e/corner <cube dir> [<cube dir> ...]
 *
 * A cube directory holds corner-0.jpg, corner-1.jpg and meta.json (tools/synth/generate.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { chromium } from 'playwright-core';
import { ROTATIONS, rotateState } from '../src/cube/rotations';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf('--' + name);
  if (i < 0) return fallback;
  const v = args[i + 1] as string;
  args.splice(i, 2);
  return v;
};
const url = opt('url', 'http://localhost:5173/');
const out = resolve(opt('out', 'tmp/e2e/corner'));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const results: unknown[] = [];

for (const dirArg of args) {
  const dir = resolve(dirArg);
  const name = basename(dir);
  const truth = (JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { state: number[] }).state;
  // Start as a first-time visitor: a saved session would reopen the last screen instead of home.
  // The stores are cleared from a page of the same site that does not run the app, because the app
  // saves its session again once it has finished reopening the last one.
  await page.goto(new URL('icon.svg', url).href);
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        localStorage.clear();
        const request = indexedDB.deleteDatabase('cube6');
        request.onsuccess = request.onerror = request.onblocked = () => done();
      }),
  );
  await page.goto(url);
  await page.click('[data-testid=corners]');
  const unsure: boolean[] = [];
  let rejected = false;
  for (let i = 0; i < 2; i++) {
    await page.waitForSelector('.vz-file input', { state: 'attached' });
    await page.setInputFiles('.vz-file input', [join(dir, 'corner-' + i + '.jpg'), join(dir, 'corner-' + i + '.png')].find(existsSync) as string);
    await page.waitForSelector('[data-testid=use-photo]', { timeout: 60000 });
    await page.waitForTimeout(600);
    unsure.push((await page.$('[data-testid=unsure]')) !== null);
    await page.screenshot({ path: join(out, name + '-outline-' + i + '.png') });
    await page.click('[data-testid=use-photo]');
  }
  try {
    await page.waitForSelector('.review .grid', { timeout: 20000 });
  } catch {
    rejected = true;
  }
  if (rejected) {
    results.push({ cube: name, unsure, rejected: true, message: await page.textContent('[role=alert]') });
    continue;
  }
  const scanned = new Array<number>(216).fill(255);
  for (const f of [2, 1, 5, 4, 0, 3]) {
    await page.click('[data-testid=face-' + f + ']');
    const cells = await page.$$eval('.review .grid .cell', (els) => els.map((e) => [Number((e as HTMLElement).dataset.i), Number((e as HTMLElement).dataset.c)]));
    for (const [i, c] of cells) scanned[i as number] = c as number;
  }
  // Colour ids are arbitrary, so each true colour is matched to the scanned id it most often became.
  const differing = (want: ArrayLike<number>): number => {
    const votes = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
    for (let i = 0; i < 216; i++) (votes[want[i] as number] as number[])[scanned[i] as number]!++;
    const map = votes.map((v) => v.indexOf(Math.max(...v)));
    let n = 0;
    for (let i = 0; i < 216; i++) if (map[want[i] as number] !== scanned[i]) n++;
    return n;
  };
  const wrong = differing(truth);
  // The quick scan may hold the cube another way round than the reference does: that is the same cube,
  // and just as solvable. So also compare against the reference turned each of the 24 ways.
  let wrongAnyWayRound = wrong;
  let rotation = 0;
  for (const rot of ROTATIONS) {
    const n = differing(rotateState(rot, Uint8Array.from(truth)));
    if (n < wrongAnyWayRound) [wrongAnyWayRound, rotation] = [n, rot.index];
  }
  await page.screenshot({ path: join(out, name + '-review.png') });
  results.push({ cube: name, unsure, wrong, wrongAnyWayRound, rotation, valid: (await page.$('[data-testid=valid]')) !== null });
}
await browser.close();
writeFileSync(join(out, 'result.json'), JSON.stringify({ results, errors }, null, 2));
console.log(JSON.stringify({ results, errors }, null, 2));
