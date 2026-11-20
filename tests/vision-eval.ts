/**
 * Full accuracy run of the photo recognition pipeline on the synthetic photo set.
 *
 *   npx tsx tests/vision-eval.ts --set tmp/vision/synth/v1 [--no-detect] [--no-corner] [--fixtures tests/vision-fixtures.json]
 *
 * Reports per-sticker accuracy before any correction, with the true quad (colour model alone) and
 * with detectFaceQuad (end to end), by condition, and the share of cubes with 0, 1-3 and more than 3
 * wrong stickers. Also runs the two-photo corner-shot mode. Writes <set>/eval.json and <set>/eval.md.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readImage } from '../tools/synth/node-image';
import { mulberry32 } from '../tools/synth/shot';
import { assembleCornerShots, classifyCube, cornerQuads, detectCornerOutline, detectFaceQuad, sampleCornerShot, sampleFace } from '../src/vision/index';
import { buildEdgeMap, refinePoints, refineQuad, CORNER_OUTSIDE } from '../src/vision/refine';
import { compare } from './vision-eval-lib';
import type { Classification, CornerOutline, CornerView, FaceSample, Point, Quad } from '../src/vision/index';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const flag = (name: string) => process.argv.includes('--' + name);
const set = arg('set', 'tmp/vision/synth/v1');
const fixturesPath = arg('fixtures', '');
const index = JSON.parse(readFileSync(set + '/index.json', 'utf8')) as { cubes: string[] };

interface Tally {
  cubes: number;
  wrong: number;
  perCube: number[];
  confusion: Record<string, number>;
  /** Wrong stickers that were among the 12 least confident of their cube. */
  flagged: number;
}
const newTally = (): Tally => ({ cubes: 0, wrong: 0, perCube: [], confusion: {}, flagged: 0 });
function add(t: Tally, result: Classification, truth: number[], names: string[]): number {
  const { wrong, mapping } = compare(result, truth);
  t.cubes++;
  t.wrong += wrong.length;
  t.perCube.push(wrong.length);
  const order = Array.from({ length: 216 }, (_, i) => i).sort((a, b) => (result.confidence[a] as number) - (result.confidence[b] as number));
  const low = new Set(order.slice(0, 12));
  for (const i of wrong) {
    const key = names[truth[i] as number] + ' read as ' + names[mapping[result.labels[i] as number] as number];
    t.confusion[key] = (t.confusion[key] || 0) + 1;
    if (low.has(i)) t.flagged++;
  }
  return wrong.length;
}
function summary(t: Tally): Record<string, unknown> {
  const n = Math.max(1, t.cubes);
  return {
    cubes: t.cubes,
    accuracy: Number((100 * (1 - t.wrong / (n * 216))).toFixed(3)),
    wrongStickers: t.wrong,
    cubes0: t.perCube.filter((w) => w === 0).length,
    cubes1to3: t.perCube.filter((w) => w >= 1 && w <= 3).length,
    cubesOver3: t.perCube.filter((w) => w > 3).length,
    worst: Math.max(0, ...t.perCube),
    wrongAmong12LeastConfident: t.flagged,
    confusion: Object.fromEntries(Object.entries(t.confusion).sort((a, b) => b[1] - a[1])),
  };
}

const settings = ['trueQuad', 'detect', 'cornerTrue', 'cornerSnapped', 'cornerDetect'] as const;
type Setting = (typeof settings)[number];
const tallies: Record<Setting, Record<string, Tally>> = { trueQuad: {}, detect: {}, cornerTrue: {}, cornerSnapped: {}, cornerDetect: {} };
const tallyFor = (s: Setting, cond: string): Tally[] => [(tallies[s][cond] ||= newTally()), (tallies[s].ALL ||= newTally())];
const quadErrors: Record<string, number[]> = {};
const outlineErrors: Record<string, number[]> = {};
const timing = { samplePlusClassify: [] as number[], detectFace: [] as number[], detectCorner: [] as number[] };
const fixtures: Record<string, unknown>[] = [];
const fixtureCount: Record<string, number> = {};
const toPts = (a: number[][]): Point[] => a.map((p) => ({ x: p[0] as number, y: p[1] as number }));
const med = (a: number[]) => (a.length ? (a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] as number) : NaN);

for (const name of index.cubes) {
  const dir = set + '/' + name;
  if (!existsSync(dir + '/meta.json')) continue;
  const meta = JSON.parse(readFileSync(dir + '/meta.json', 'utf8')) as {
    condition: string;
    state: number[];
    colourNames: string[];
    shots: { kind: string; face?: number; view?: CornerView; file: string; quad?: number[][]; outline?: number[][] }[];
  };
  const cond = meta.condition;
  const faceShots = meta.shots.filter((s) => s.kind === 'face').sort((a, b) => (a.face as number) - (b.face as number));
  const images = faceShots.map((s) => readImage(dir + '/' + s.file));

  // A. true quad
  const t0 = performance.now();
  const samples = faceShots.map((s, i) => sampleFace(images[i] as ReturnType<typeof readImage>, toPts(s.quad as number[][]) as Quad));
  const resultTrue = classifyCube(samples);
  timing.samplePlusClassify.push(performance.now() - t0);
  let wrongTrue = 0;
  for (const t of tallyFor('trueQuad', cond)) wrongTrue = add(t, resultTrue, meta.state, meta.colourNames);
  if (fixturesPath && (fixtureCount[cond] || 0) < 1) {
    fixtureCount[cond] = (fixtureCount[cond] || 0) + 1;
    fixtures.push({
      name,
      condition: cond,
      wrongWhenRecorded: wrongTrue,
      truth: meta.state.join(''),
      rgb: samples.flatMap((s) => Array.from(s.rgb).map((v) => Math.round(v))),
      quality: samples.flatMap((s) => Array.from(s.quality).map((v) => Math.round(v * 100) / 100)),
    });
  }

  // B. detected quad
  if (!flag('no-detect')) {
    const detSamples: FaceSample[] = [];
    faceShots.forEach((s, i) => {
      const img = images[i] as ReturnType<typeof readImage>;
      const t1 = performance.now();
      const det = detectFaceQuad(img);
      timing.detectFace.push(performance.now() - t1);
      const truth = toPts(s.quad as number[][]);
      const side = (Math.hypot(truth[1]!.x - truth[0]!.x, truth[1]!.y - truth[0]!.y) + Math.hypot(truth[3]!.x - truth[0]!.x, truth[3]!.y - truth[0]!.y)) / 2;
      // A detected quad may be a rotation of the true one by a quarter turn: the detector cannot know which way is up.
      let bestErr = Infinity;
      let bestRot = 0;
      for (let rot = 0; rot < 4; rot++) {
        let e = 0;
        for (let k = 0; k < 4; k++) e = Math.max(e, Math.hypot(det.quad[(k + rot) % 4]!.x - truth[k]!.x, det.quad[(k + rot) % 4]!.y - truth[k]!.y));
        if (e < bestErr) {
          bestErr = e;
          bestRot = rot;
        }
      }
      (quadErrors[cond] ||= []).push(bestErr / (side / 6));
      (quadErrors.ALL ||= []).push(bestErr / (side / 6));
      const upright = [0, 1, 2, 3].map((k) => det.quad[(k + bestRot) % 4] as Point) as Quad;
      detSamples.push(sampleFace(img, upright));
    });
    const resultDet = classifyCube(detSamples);
    for (const t of tallyFor('detect', cond)) add(t, resultDet, meta.state, meta.colourNames);
  }

  // C. corner shots: two photos per cube
  if (!flag('no-corner')) {
    const cornerShots = meta.shots.filter((s) => s.kind === 'corner');
    const rnd = mulberry32(name.length * 7919 + cornerShots.length);
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
    const variants: Record<string, { view: CornerView; faces: [FaceSample, FaceSample, FaceSample] }[]> = { cornerTrue: [], cornerSnapped: [], cornerDetect: [] };
    for (const s of cornerShots) {
      const img = readImage(dir + '/' + s.file);
      const truth = toPts(s.outline as number[][]) as CornerOutline;
      variants.cornerTrue!.push({ view: s.view as CornerView, faces: sampleCornerShot(img, truth) });
      // A person placing the points by hand: a few pixels off everywhere, then snapped to the grid.
      const jittered = truth.map((p) => ({ x: p.x + gauss() * 5, y: p.y + gauss() * 5 }));
      const edge = buildEdgeMap(img, 1000);
      const snapped = refinePoints(edge, jittered, (p) => cornerQuads(p as CornerOutline), 5, CORNER_OUTSIDE).points as CornerOutline;
      variants.cornerSnapped!.push({ view: s.view as CornerView, faces: sampleCornerShot(img, snapped) });
      const t1 = performance.now();
      const det = detectCornerOutline(img);
      timing.detectCorner.push(performance.now() - t1);
      let e = 0;
      for (let k = 0; k < 7; k++) e = Math.max(e, Math.hypot(det.outline[k]!.x - truth[k]!.x, det.outline[k]!.y - truth[k]!.y));
      const width = Math.max(...truth.map((p) => p.x)) - Math.min(...truth.map((p) => p.x));
      (outlineErrors[cond] ||= []).push(e / (width / 8.5));
      (outlineErrors.ALL ||= []).push(e / (width / 8.5));
      variants.cornerDetect!.push({ view: s.view as CornerView, faces: sampleCornerShot(img, det.outline) });
    }
    for (const key of ['cornerTrue', 'cornerSnapped', 'cornerDetect'] as const) {
      const faces = assembleCornerShots(variants[key] as { view: CornerView; faces: [FaceSample, FaceSample, FaceSample] }[]);
      if (faces.some((f) => !f)) continue;
      const result = classifyCube(faces as FaceSample[]);
      for (const t of tallyFor(key, cond)) add(t, result, meta.state, meta.colourNames);
    }
  }
}

const out: Record<string, unknown> = { set, timingMs: { samplePlusClassifyMedian: med(timing.samplePlusClassify), detectFaceMedian: med(timing.detectFace), detectCornerMedian: med(timing.detectCorner) } };
const lines: string[] = [];
for (const s of settings) {
  const block: Record<string, unknown> = {};
  const conds = Object.keys(tallies[s]).filter((c) => c !== 'ALL');
  if (!conds.length) continue;
  lines.push('', '### ' + s, '', '| condition | cubes | accuracy % | wrong stickers | 0 wrong | 1-3 wrong | >3 wrong | worst cube |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of [...conds, 'ALL']) {
    const sm = summary(tallies[s][c] as Tally);
    block[c] = sm;
    lines.push('| ' + [c, sm.cubes, sm.accuracy, sm.wrongStickers, sm.cubes0, sm.cubes1to3, sm.cubesOver3, sm.worst].join(' | ') + ' |');
  }
  const all = summary(tallies[s].ALL as Tally);
  lines.push('', 'Confusions: ' + (Object.entries(all.confusion as Record<string, number>).slice(0, 8).map(([k, v]) => k + ' x' + v).join(', ') || 'none') + '. Wrong stickers among the 12 least confident of their cube: ' + all.wrongAmong12LeastConfident + ' of ' + all.wrongStickers + '.');
  out[s] = block;
}
const share = (a: number[], limit: number) => (a.length ? Number(((100 * a.filter((v) => v <= limit).length) / a.length).toFixed(1)) : NaN);
const geo: Record<string, unknown> = {};
for (const [label, table] of [
  ['faceQuad', quadErrors],
  ['cornerOutline', outlineErrors],
] as const) {
  const conds = Object.keys(table);
  if (!conds.length) continue;
  lines.push('', '### ' + label + ' detection error (worst corner, in sticker widths)', '', '| condition | photos | median | within 0.25 % | within 0.5 % |', '| --- | --- | --- | --- | --- |');
  const block: Record<string, unknown> = {};
  for (const c of [...conds.filter((x) => x !== 'ALL'), 'ALL']) {
    const a = table[c] as number[];
    block[c] = { photos: a.length, median: Number(med(a).toFixed(3)), within025: share(a, 0.25), within05: share(a, 0.5) };
    lines.push('| ' + [c, a.length, med(a).toFixed(3), share(a, 0.25), share(a, 0.5)].join(' | ') + ' |');
  }
  geo[label] = block;
}
out.geometry = geo;
lines.push('', 'Timing (Node, median per call): six faces sampled and classified ' + med(timing.samplePlusClassify).toFixed(1) + ' ms, detectFaceQuad ' + med(timing.detectFace).toFixed(0) + ' ms, detectCornerOutline ' + med(timing.detectCorner).toFixed(0) + ' ms.');
writeFileSync(set + '/eval.json', JSON.stringify(out, null, 1));
writeFileSync(set + '/eval.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));
if (fixturesPath) {
  writeFileSync(fixturesPath, JSON.stringify({ note: 'Sticker samples (sRGB means and quality) of synthetic cubes, one per condition, taken with the true quads. Numbers only, no images. Regenerate with tests/vision-eval.ts --fixtures.', cubes: fixtures }));
  console.log('wrote', fixturesPath, fixtures.length, 'cubes');
}
