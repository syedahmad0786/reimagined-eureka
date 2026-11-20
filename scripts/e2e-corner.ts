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
  const votes = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (let i = 0; i < 216; i++) (votes[truth[i] as number] as number[])[scanned[i] as number]!++;
  const map = votes.map((v) => v.indexOf(Math.max(...v)));
  let wrong = 0;
  for (let i = 0; i < 216; i++) if (map[truth[i] as number] !== scanned[i]) wrong++;
  await page.screenshot({ path: join(out, name + '-review.png') });
  results.push({ cube: name, unsure, wrong, valid: (await page.$('[data-testid=valid]')) !== null });
}
await browser.close();
writeFileSync(join(out, 'result.json'), JSON.stringify({ results, errors }, null, 2));
console.log(JSON.stringify({ results, errors }, null, 2));
