/**
 * The quick scan on two of the reference photos, in Chromium, through the app's own assembleTwoShots
 * (src/app/CornerCapture.tsx): is the state it produces the reference state, up to a whole-cube rotation?
 *
 *   npx tsx tools/synth/pair-check.ts [--port 5182] 5,4 1,3
 *
 * The photos are read from the drive and handed to the page in memory; nothing is copied.
 * The reference state (tmp/vision/reference-state.json) calls the corner of photo 1 the top-front-right
 * corner. A scan that starts with another photo sees the same cube turned as a whole, so the scanned
 * state is compared with the reference under each of the 24 whole-cube rotations (src/cube/rotations.ts),
 * after matching the colour ids, which are arbitrary labels.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { ROTATIONS, rotateState } from '../../src/cube/rotations';
import { validateState } from '../../src/cube/validate';

const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '5182';
const pairs = args.filter((a) => /^\d,\d$/.test(a));
const DIR = process.env.HOME + '/.capy/drive/captain-rubic/handoffs/reference-photos/';
const reference = (JSON.parse(readFileSync('tmp/vision/reference-state.json', 'utf8')) as { state: number[] }).state;

const PERMS: number[][] = [];
(function build(p: number[], rest: number[]): void {
  if (!rest.length) {
    PERMS.push(p);
    return;
  }
  rest.forEach((v, i) => build([...p, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
})([], [0, 1, 2, 3, 4, 5]);
/** Stickers that differ after the best one-to-one relabelling of the colours. */
function differing(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const agree = new Int32Array(36);
  for (let i = 0; i < 216; i++) agree[(a[i] as number) * 6 + (b[i] as number)] += 1;
  let best = 0;
  for (const p of PERMS) {
    let s = 0;
    for (let k = 0; k < 6; k++) s += agree[k * 6 + (p[k] as number)] as number;
    best = Math.max(best, s);
  }
  return 216 - best;
}

const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.error('page error', e.message));
await page.goto('http://localhost:' + port + '/demo/vision.html');
await page.waitForFunction('window.visionDemoReady === true', undefined, { timeout: 60000 });
for (const pair of pairs.length ? pairs : ['5,4', '1,3']) {
  const files = pair.split(',').map((n) => readFileSync(DIR + 'cube-corner-' + n + '.jpeg').toString('base64'));
  const result = await page.evaluate(async (photos) => {
    const vision = await import('/src/vision/index.ts' as string);
    const app = await import('/src/app/CornerCapture.tsx' as string);
    const shots = [];
    for (const b64 of photos) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const image = await vision.loadImageFile(new Blob([bytes], { type: 'image/jpeg' }));
      const found = vision.detectCornerOutline(image);
      shots.push({ image, outline: found.outline, confidence: found.confidence });
    }
    const assembled = app.assembleTwoShots(shots[0], shots[1]);
    const labels = vision.classifyCube(assembled.photos.map((p: { sample: unknown }) => p.sample)).labels;
    return { labels: Array.from(labels as Uint8Array), badness: assembled.badness as number, confidence: shots.map((s) => s.confidence as number), size: [shots[0].image.width, shots[0].image.height] };
  }, files);
  const asIs = differing(result.labels, reference);
  const perRotation = ROTATIONS.map((r) => differing(rotateState(r, Uint8Array.from(result.labels)), reference));
  const best = perRotation.indexOf(Math.min(...perRotation));
  const valid = validateState(Uint8Array.from(result.labels));
  console.log(
    JSON.stringify({
      photos: pair,
      browser: 'Chromium ' + browser.version(),
      photoSize: result.size,
      outlineConfidence: result.confidence,
      badnessOfChosenArrangement: result.badness,
      validCube: valid.ok,
      differingFromReferenceAsScanned: asIs,
      bestRotation: best,
      rotationMatrix: (ROTATIONS[best] as { matrix: number[][] }).matrix,
      differingAfterBestRotation: perRotation[best],
      differingPerRotation: perRotation,
    }),
  );
}
await browser.close();
