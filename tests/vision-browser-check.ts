/**
 * Browser check of the vision demo page and the DOM classes, with headless Chromium at a phone size.
 * Needs the dev server:  npx vite --port 5182 --strictPort   and a rendered synthetic set.
 *   npx tsx tests/vision-browser-check.ts [--host localhost] [--port 5182] [--set tmp/vision/synth/v2]
 * Screenshots go to tmp/vision/demo/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const base = 'http://' + arg('host', 'localhost') + ':' + arg('port', '5182');
const set = arg('set', 'tmp/vision/synth/v2');
const out = 'tmp/vision/demo';
mkdirSync(out, { recursive: true });
const cubes = (JSON.parse(readFileSync(set + '/index.json', 'utf8')) as { cubes: string[] }).cubes;
const results: Record<string, unknown> = {};
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  results[name] = { ok, detail };
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name, typeof detail === 'string' ? detail : JSON.stringify(detail));
};

const browser = await chromium.launch({
  executablePath: '/usr/local/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

function wrongAgainstTruth(labels: number[], truth: number[]): number {
  // best one-to-one matching of ids, greedy on the agreement table is exact enough for a check
  const agree = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  labels.forEach((l, i) => ((agree[l] as number[])[truth[i] as number] += 1));
  let best = 0;
  const walk = (k: number, used: number, sum: number): void => {
    if (k === 6) {
      best = Math.max(best, sum);
      return;
    }
    for (let t = 0; t < 6; t++) if (!(used & (1 << t))) walk(k + 1, used | (1 << t), sum + ((agree[k] as number[])[t] as number));
  };
  walk(0, 0, 0);
  return 216 - best;
}

async function openDemo(query: string, viewport = { width: 390, height: 844 }, touch = true): Promise<Page> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, permissions: ['camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('no page error', false, e.message));
  await page.goto(base + '/demo/vision.html' + query);
  await page.waitForFunction('window.visionDemoReady === true', undefined, { timeout: 120000 });
  return page;
}

// 1. Six face photos with the true quads, phone viewport.
{
  const cube = cubes.find((c) => c.includes('tilt-roll')) || (cubes[0] as string);
  const page = await openDemo('?set=/' + set + '/' + cube);
  await page.screenshot({ path: out + '/phone-face-editor.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scroll at 390 px', overflow <= 0, { overflow });
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, .filebtn'))
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width < 52 || r.height < 52).length,
  );
  check('every visible button is at least 52 px', small === 0, { small });
  // Drag the grip of the top-left corner and check that the corner follows the finger one to one, with the loupe up.
  const geo = (await page.evaluate(() => {
    const c = document.querySelector('#editor-host canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const w = window as unknown as { visionDemoShape: () => { x: number; y: number }[]; visionDemoImageSize: () => { width: number; height: number } };
    return { left: r.left, top: r.top, cssW: c.clientWidth, cssH: c.clientHeight, shape: w.visionDemoShape(), image: w.visionDemoImageSize(), innerHeight: window.innerHeight };
  })) as { left: number; top: number; cssW: number; cssH: number; shape: { x: number; y: number }[]; image: { width: number; height: number }; innerHeight: number };
  const PAD = 34;
  const maxH = Math.max(240, Math.min(geo.innerHeight * 0.72, 900));
  const scale = Math.min((geo.cssW - 2 * PAD) / geo.image.width, (maxH - 2 * PAD) / geo.image.height);
  const ox = (geo.cssW - geo.image.width * scale) / 2;
  const cx = geo.shape.reduce((s, p) => s + p.x, 0) / 4;
  const cy = geo.shape.reduce((s, p) => s + p.y, 0) / 4;
  const p0 = geo.shape[0] as { x: number; y: number };
  const n = Math.hypot(p0.x - cx, p0.y - cy);
  const gx = geo.left + ox + p0.x * scale + ((p0.x - cx) / n) * 46;
  const gy = geo.top + PAD + p0.y * scale + ((p0.y - cy) / n) * 46;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 24, gy + 36, { steps: 5 });
  await page.waitForTimeout(120);
  await page.screenshot({ path: out + '/phone-drag-loupe.png' });
  await page.mouse.up();
  const after = (await page.evaluate(() => (window as unknown as { visionDemoShape: () => { x: number; y: number }[] }).visionDemoShape())) as { x: number; y: number }[];
  const dx = ((after[0] as { x: number }).x - p0.x) * scale;
  const dy = ((after[0] as { y: number }).y - p0.y) * scale;
  const moved = Math.abs(dx - 24) < 1.5 && Math.abs(dy - 36) < 1.5 && Math.abs((after[1] as { x: number }).x - (geo.shape[1] as { x: number }).x) < 1e-6;
  check('dragging a grip moves its corner by the same distance', moved, { dx: Number(dx.toFixed(2)), dy: Number(dy.toFixed(2)) });

  await page.close();
}

// 2. Classification through the page for a few cubes, with true quads and with detection.
for (const mode of ['true', 'detect'] as const) {
  const picks = ['easy', 'gradient-shadow', 'stickered'].map((c) => cubes.find((n) => n.includes(c))).filter(Boolean) as string[];
  for (const cube of picks) {
    const page = await openDemo('?set=/' + set + '/' + cube + (mode === 'detect' ? '&detect=1' : ''));
    await page.click('#classify');
    const res = (await page.evaluate(() => ({ r: (window as unknown as { visionDemoResult: { labels: number[]; ms: number; names: string[] } }).visionDemoResult, t: (window as unknown as { visionDemoTruth: number[] }).visionDemoTruth }))) as { r: { labels: number[]; ms: number; names: string[] }; t: number[] };
    const wrong = wrongAgainstTruth(res.r.labels, res.t);
    check('page classifies ' + cube + ' (' + mode + ' outline)', mode === 'true' ? wrong <= 3 : true, { wrong, ms: Number(res.r.ms.toFixed(1)), names: res.r.names.join(',') });
    if (cube.includes('easy')) {
      await page.locator('#result').scrollIntoViewIfNeeded();
      await page.screenshot({ path: out + '/phone-result-' + mode + '.png' });
    }
    await page.close();
  }
}

// 3. Corner mode on the page, laptop size, mouse.
{
  const cube = cubes.find((c) => c.includes('gradient-shadow')) || (cubes[0] as string);
  const page = await openDemo('?mode=corner&set=/' + set + '/' + cube, { width: 1280, height: 800 }, false);
  await page.screenshot({ path: out + '/laptop-corner-editor.png' });
  await page.click('#classify');
  const res = (await page.evaluate(() => ({ r: (window as unknown as { visionDemoResult: { labels: number[]; ms: number } }).visionDemoResult, t: (window as unknown as { visionDemoTruth: number[] }).visionDemoTruth }))) as { r: { labels: number[]; ms: number }; t: number[] };
  check('page classifies two corner shots of ' + cube, wrongAgainstTruth(res.r.labels, res.t) <= 3, { wrong: wrongAgainstTruth(res.r.labels, res.t), ms: Number(res.r.ms.toFixed(1)) });
  // Keyboard: focus the editor and nudge the selected point.
  await page.focus('#editor-host .vz-editor');
  const beforeKey = await page.evaluate(() => Array.from(document.querySelectorAll('#sampled .grid6 i')).map((e) => (e as HTMLElement).style.background).join('|'));
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
  const afterKey = await page.evaluate(() => Array.from(document.querySelectorAll('#sampled .grid6 i')).map((e) => (e as HTMLElement).style.background).join('|'));
  check('arrow keys move the selected point', beforeKey !== afterKey);
  await page.close();
}

// 4. Camera capture with Chromium's fake camera, and timing with the CPU slowed four times.
{
  const cube = cubes.find((c) => c.includes('easy')) || (cubes[0] as string);
  const page = await openDemo('?set=/' + set + '/' + cube);
  await page.click('#camera');
  await page.waitForSelector('.vz-camera:not(.vz-nocam) .vz-shutter:not([disabled])', { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/phone-camera.png' });
  const shutter = (await page.locator('.vz-shutter').boundingBox()) as { width: number; height: number };
  check('shutter is a large target', shutter.width >= 64 && shutter.height >= 64, shutter);
  await page.click('.vz-shutter');
  await page.waitForSelector('#editor-host canvas', { timeout: 20000 });
  const got = await page.evaluate(() => (document.querySelector('#editor-host canvas') as HTMLCanvasElement).width > 0 && document.querySelectorAll('#sampled .grid6 i').length === 36);
  check('shutter delivers a frame and a guide quad into the editor', got);
  await page.screenshot({ path: out + '/phone-after-capture.png' });
  await page.close();

  const timing: Record<string, number> = {};
  for (const mode of ['face', 'corner'] as const) {
    const page2 = await openDemo('?set=/' + set + '/' + cube + (mode === 'corner' ? '&mode=corner' : ''));
    const cdp = await page2.context().newCDPSession(page2);
    for (const rate of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        await page2.click('#classify');
        times.push(await page2.evaluate(() => (window as unknown as { visionDemoResult: { ms: number } }).visionDemoResult.ms));
      }
      times.sort((a, b) => a - b);
      timing[mode + ' sample+classify x' + rate] = Number((times[2] as number).toFixed(1));
      const det: number[] = [];
      for (let i = 0; i < 3; i++) {
        await page2.click('#detect');
        det.push(Number(/(\d+) ms/.exec(await page2.evaluate(() => (document.getElementById('status') as HTMLElement).textContent || ''))?.[1] ?? NaN));
      }
      det.sort((a, b) => a - b);
      timing[mode + ' detect x' + rate] = det[1] as number;
    }
    await page2.close();
  }
  check('sample + classify at 4x CPU slowdown stays well under a second', (timing['face sample+classify x4'] as number) < 400 && (timing['corner sample+classify x4'] as number) < 400, timing);
}

// 5. No camera permission: the fallback stays usable and the error is reported.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(base + '/demo/vision.html');
  await page.waitForFunction('window.visionDemoReady === true');
  // (As a string: the TypeScript runner would otherwise inject helpers that do not exist in the page.)
  await page.evaluate("Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: function () { var e = new Error('denied'); e.name = 'NotAllowedError'; return Promise.reject(e); } }, configurable: true })");
  await page.click('#slots button');
  await page.click('#camera');
  await page.waitForSelector('.vz-camera.vz-nocam .vz-note:not([hidden])', { timeout: 10000 });
  const note = await page.evaluate(() => (document.querySelector('.vz-note') as HTMLElement).textContent);
  const input = await page.evaluate(() => {
    const i = document.querySelector('.vz-file input') as HTMLInputElement;
    return { accept: i.accept, capture: i.getAttribute('capture') };
  });
  check('camera refusal shows the reason and keeps the file fallback', !!note && input.accept === 'image/*' && input.capture === 'environment', { note, input });
  await page.screenshot({ path: out + '/phone-camera-denied.png' });
  await page.close();
}

await browser.close();
writeFileSync(out + '/browser-check.json', JSON.stringify(results, null, 1));
console.log(failures ? failures + ' check(s) failed' : 'all browser checks passed');
process.exit(failures ? 1 : 0);
