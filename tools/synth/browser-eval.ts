/**
 * Needs a dev server that serves this checkout (npx vite). Runs the app's file path (loadImageFile + detectFaceQuad + sampleFace + classifyCube) inside Chromium for every
 * cube of a set, and compares the detection with Node on the same files.
 *   npx tsx tools/synth/browser-eval.ts http://localhost:5173 tmp/vision/synth/v3 [filter]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { readImage } from './node-image';
import { detectFaceQuad } from '../../src/vision/index';

const base = process.argv[2] as string;
const set = process.argv[3] as string;
const filter = process.argv[4] || '';
const cubes = (JSON.parse(readFileSync(set + '/index.json', 'utf8')) as { cubes: string[] }).cubes.filter((c) => !filter || c.includes(filter));
const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto(base + '/demo/vision.html');
await page.waitForFunction('window.visionDemoReady === true', undefined, { timeout: 120000 });

function wrongAgainstTruth(labels: number[], truth: number[]): number {
  const agree = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  labels.forEach((l, i) => ((agree[l] as number[])[truth[i] as number] += 1));
  let best = 0;
  const walk = (k: number, used: number, sum: number): void => {
    if (k === 6) { best = Math.max(best, sum); return; }
    for (let t = 0; t < 6; t++) if (!(used & (1 << t))) walk(k + 1, used | (1 << t), sum + ((agree[k] as number[])[t] as number));
  };
  walk(0, 0, 0);
  return 216 - best;
}
type P = { x: number; y: number };
function quadError(quad: P[], truth: P[]): number {
  const side = (Math.hypot(truth[1]!.x - truth[0]!.x, truth[1]!.y - truth[0]!.y) + Math.hypot(truth[3]!.x - truth[0]!.x, truth[3]!.y - truth[0]!.y)) / 2;
  let best = Infinity;
  for (let rot = 0; rot < 4; rot++) {
    let e = 0;
    for (let k = 0; k < 4; k++) e = Math.max(e, Math.hypot(quad[(k + rot) % 4]!.x - truth[k]!.x, quad[(k + rot) % 4]!.y - truth[k]!.y));
    best = Math.min(best, e);
  }
  return best / (side / 6);
}

const inPage = `(async (dir, shots, wantPixels) => {
  const v = await import('/src/vision/index.ts');
  const images = [];
  for (const s of shots) images.push(await v.loadImageFile(await (await fetch(dir + '/' + s.file)).blob()));
  const dets = images.map((im) => v.detectFaceQuad(im));
  const det = v.classifyCube(images.map((im, i) => v.sampleFace(im, dets[i].quad)));
  const tru = v.classifyCube(images.map((im, i) => v.sampleFace(im, shots[i].quad.map((p) => ({ x: p[0], y: p[1] })))));
  const pixels = wantPixels.map((i) => { const d = images[i].data; let s = ''; for (let k = 0; k < d.length; k += 32768) s += String.fromCharCode.apply(null, d.subarray(k, k + 32768)); return btoa(s); });
  return { size: images.map((im) => [im.width, im.height]), quads: dets.map((d) => d.quad), confidence: dets.map((d) => d.confidence), detLabels: Array.from(det.labels), trueLabels: Array.from(tru.labels), pixels };
})`;

const rows: Record<string, unknown>[] = [];
const byCond: Record<string, { cubes: number; trueWrong: number[]; detWrong: number[]; faces: number; within: number; nodeWithin: number }> = {};
let dumps = 0;
for (const cube of cubes) {
  const dir = set + '/' + cube;
  const meta = JSON.parse(readFileSync(dir + '/meta.json', 'utf8'));
  const shots = meta.shots.filter((s: any) => s.kind === 'face').sort((a: any, b: any) => a.face - b.face);
  const call = (want: number[]) => page.evaluate(inPage + '(' + JSON.stringify('/' + dir) + ',' + JSON.stringify(shots.map((s: any) => ({ file: s.file, quad: s.quad }))) + ',' + JSON.stringify(want) + ')') as Promise<any>;
  const res = await call([]);
  const truths = shots.map((s: any) => s.quad.map((p: number[]) => ({ x: p[0], y: p[1] })) as P[]);
  const errs = res.quads.map((q: P[], i: number) => quadError(q, truths[i]));
  const nodeImages = shots.map((s: any) => readImage(dir + '/' + s.file));
  const nodeErrs = nodeImages.map((im: any, i: number) => quadError(detectFaceQuad(im).quad, truths[i]));
  const trueWrong = wrongAgainstTruth(res.trueLabels, meta.state);
  const detWrong = wrongAgainstTruth(res.detLabels, meta.state);
  const differ = errs.map((e: number, i: number) => (e > 0.25) !== (nodeErrs[i] > 0.25) ? i : -1).filter((i: number) => i >= 0);
  const row: Record<string, unknown> = { cube, condition: meta.condition, trueWrong, detWrong, browserErr: errs.map((e: number) => +e.toFixed(2)), nodeErr: nodeErrs.map((e: number) => +e.toFixed(2)), confidence: res.confidence.map((c: number) => +c.toFixed(2)) };
  if (differ.length && dumps < 4) {
    dumps++;
    const withPixels = await call(differ);
    row.pixelCheck = differ.map((face: number, k: number) => {
      const bytes = Buffer.from(withPixels.pixels[k], 'base64');
      const node = nodeImages[face];
      const browserImage = { width: withPixels.size[face][0], height: withPixels.size[face][1], data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length) };
      let sum = 0, max = 0, n = 0;
      if (browserImage.width === node.width && browserImage.height === node.height) for (let i = 0; i < bytes.length; i++) if (i % 4 !== 3) { const d = Math.abs(bytes[i]! - node.data[i]); sum += d; if (d > max) max = d; n++; }
      return { face, browserSize: withPixels.size[face], nodeSize: [node.width, node.height], meanAbsDiff: n ? +(sum / n).toFixed(3) : null, maxAbsDiff: max, nodeDetectOnBrowserPixelsErr: +quadError(detectFaceQuad(browserImage).quad, truths[face]).toFixed(2), nodeDetectOnNodePixelsErr: +nodeErrs[face].toFixed(2), browserDetectErr: +errs[face].toFixed(2) };
    });
  }
  rows.push(row);
  for (const c of [meta.condition, 'ALL']) {
    const t = (byCond[c] ||= { cubes: 0, trueWrong: [], detWrong: [], faces: 0, within: 0, nodeWithin: 0 });
    t.cubes++;
    t.trueWrong.push(trueWrong);
    t.detWrong.push(detWrong);
    t.faces += 6;
    t.within += errs.filter((e: number) => e <= 0.25).length;
    t.nodeWithin += nodeErrs.filter((e: number) => e <= 0.25).length;
  }
  if (detWrong > 3 || differ.length) console.log(JSON.stringify(row));
}
await browser.close();
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const summary = Object.fromEntries(Object.entries(byCond).map(([c, t]) => [c, {
  cubes: t.cubes,
  trueAccuracy: +(100 - (100 * sum(t.trueWrong)) / (216 * t.cubes)).toFixed(3), trueWrong: sum(t.trueWrong),
  detAccuracy: +(100 - (100 * sum(t.detWrong)) / (216 * t.cubes)).toFixed(3), detWrong: sum(t.detWrong),
  det0: t.detWrong.filter((w) => w === 0).length, det1to3: t.detWrong.filter((w) => w >= 1 && w <= 3).length, detOver3: t.detWrong.filter((w) => w > 3).length, detWorst: Math.max(...t.detWrong),
  facesWithinQuarterBrowser: t.within + ' of ' + t.faces, facesWithinQuarterNode: t.nodeWithin + ' of ' + t.faces,
}]));
writeFileSync(set + '/browser-eval.json', JSON.stringify({ set, summary, rows }, null, 1));
console.log('| condition | cubes | true outline % | wrong | detected outline % | wrong | 0 wrong | 1-3 | >3 | worst | outlines within 0.25 (Chromium) | (Node) |');
for (const [c, s] of Object.entries(summary)) console.log('| ' + [c, s.cubes, s.trueAccuracy, s.trueWrong, s.detAccuracy, s.detWrong, s.det0, s.det1to3, s.detOver3, s.detWorst, s.facesWithinQuarterBrowser, s.facesWithinQuarterNode].join(' | ') + ' |');
