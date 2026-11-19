/**
 * Evaluation on the five reference corner shots of Ahmad's cube.
 * Usage: npx tsx tools/synth/real-eval.ts [--hand] [--auto] [--quiet]
 *   default  outlines = hand-placed points snapped to the sticker grid (refinePoints)
 *   --hand   use the hand-placed points as they are
 *   --auto   use detectCornerOutline with no human input
 * Writes tmp/vision/reference-state.json and tmp/vision/real/real-eval.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readImage } from './node-image';
import { loadOutlines, PHOTO_DIR, OUT_DIR } from './real-overlay';
import { cornerFaceletMap, cornerQuads, sampleCornerShot, type CornerView } from '../../src/vision/corner';
import { classifyCube, TUNING } from '../../src/vision/classify';
import { buildEdgeMap, refinePoints, CORNER_OUTSIDE } from '../../src/vision/refine';
import type { CornerOutline, FaceSample } from '../../src/vision/types';
import * as vision from '../../src/vision/index';

const LETTERS = 'OWGYRB';
const NAME_OF: Record<string, string> = { O: 'orange', W: 'white', G: 'green', Y: 'yellow', R: 'red', B: 'blue' };

interface Truth {
  photos: Record<string, { view: CornerView; faces: string[][] }>;
}
const truth = JSON.parse(readFileSync(new URL('./real-truth.json', import.meta.url), 'utf8')) as Truth;
const args = process.argv.slice(2);
const mode = args.includes('--hand') ? 'hand' : args.includes('--auto') ? 'auto' : 'snapped';
const quiet = args.includes('--quiet');
for (const a of args) {
  const m = /^--(\w+)=(.+)$/.exec(a);
  if (m && (m[1] as string) in TUNING) (TUNING as Record<string, number>)[m[1] as string] = Number(m[2]);
}
const log = (...a: unknown[]) => {
  if (!quiet) console.log(...a);
};

// ---- 1. Is the hand-read truth one consistent cube? -------------------------------------------
const state = new Int8Array(216).fill(-1);
const seenBy: string[][] = Array.from({ length: 216 }, () => []);
let conflicts = 0;
for (const [name, photo] of Object.entries(truth.photos)) {
  const map = cornerFaceletMap(photo.view);
  for (let k = 0; k < 3; k++)
    for (let i = 0; i < 36; i++) {
      const letter = ((photo.faces[k] as string[])[Math.floor(i / 6)] as string)[i % 6] as string;
      const id = LETTERS.indexOf(letter);
      const target = map[k * 36 + i] as number;
      if (state[target] !== -1 && state[target] !== id) {
        conflicts++;
        log('CONFLICT at facelet', target, 'photo', name, 'says', letter, 'earlier', LETTERS[state[target] as number], seenBy[target]);
      }
      state[target] = id;
      (seenBy[target] as string[]).push(name);
    }
}
const missing = Array.from(state).filter((v) => v < 0).length;
const counts = [0, 0, 0, 0, 0, 0];
for (const v of state) if (v >= 0) counts[v] = (counts[v] as number) + 1;
const multi = seenBy.filter((s) => s.length > 1).length;
log('truth: facelets covered', 216 - missing, 'of 216; seen in more than one photo', multi, '; conflicts', conflicts);
log('truth: colour counts', LETTERS.split('').map((l, i) => l + '=' + counts[i]).join(' '));
mkdirSync(OUT_DIR, { recursive: true });
if (missing === 0 && conflicts === 0) {
  const faces: Record<string, string[]> = {};
  'URFDLB'.split('').forEach((f, fi) => {
    faces[f] = [0, 1, 2, 3, 4, 5].map((r) => Array.from(state.slice(fi * 36 + r * 6, fi * 36 + r * 6 + 6)).map((v) => LETTERS[v]).join(''));
  });
  writeFileSync(
    '/workspace/tmp/vision/reference-state.json',
    JSON.stringify(
      {
        note: 'State of the cube in the five reference photos, read by eye from rectified crops. Facelet order as in docs/CONVENTIONS.md (faces U R F D L B, row-major). The solved orange face is called U and reference photo 1 is taken as the URF corner (F = the face under its green row, R = the face under its white row).',
        colours: LETTERS.split('').map((l) => NAME_OF[l]),
        state: Array.from(state),
        faces,
        sources: { U: 'photos 1, 2, 5 (top)', R: 'photo 1 (right), photo 5 (left)', F: 'photo 1 (left), photo 2 (right), photo 4 (right)', D: 'photo 3 (left), photo 4 (left)', L: 'photo 2 (left), photo 3 (right), photo 4 (top)', B: 'photo 3 (top), photo 5 (right)' },
      },
      null,
      1,
    ),
  );
  log('wrote /workspace/tmp/vision/reference-state.json');
}

// ---- 2. Sample the photos ----------------------------------------------------------------------
const hand = loadOutlines();
interface View {
  photo: string;
  slot: number; // 0 top, 1 left, 2 right
  cubeFace: number;
  /** FaceSample re-ordered into the cube face's own reading order. */
  sample: FaceSample;
  truth: Uint8Array;
}
const views: View[] = [];
const outlinesUsed: Record<string, number[][]> = {};
const timings: number[] = [];
for (const [name, photo] of Object.entries(truth.photos)) {
  const img = readImage(PHOTO_DIR + '/' + name + '.jpeg');
  let outline = hand[name] as CornerOutline;
  if (mode === 'snapped') {
    const edge = buildEdgeMap(img, 1600);
    outline = refinePoints(edge, outline, (p) => cornerQuads(p as CornerOutline), 6, CORNER_OUTSIDE).points as CornerOutline;
  } else if (mode === 'auto') {
    const t0 = performance.now();
    const det = vision.detectCornerOutline(img);
    timings.push(performance.now() - t0);
    outline = det.outline;
    log(name, 'auto outline confidence', det.confidence.toFixed(3));
  }
  outlinesUsed[name] = outline.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
  const sampled = sampleCornerShot(img, outline);
  const map = cornerFaceletMap(photo.view);
  for (let k = 0; k < 3; k++) {
    const cubeFace = Math.floor((map[k * 36] as number) / 36);
    const sample: FaceSample = { rgb: new Float32Array(108), lab: new Float32Array(108), quality: new Float32Array(36) };
    const t = new Uint8Array(36);
    for (let i = 0; i < 36; i++) {
      const j = (map[k * 36 + i] as number) % 36;
      for (let c = 0; c < 3; c++) {
        sample.rgb[j * 3 + c] = (sampled[k] as FaceSample).rgb[i * 3 + c] as number;
        sample.lab[j * 3 + c] = (sampled[k] as FaceSample).lab[i * 3 + c] as number;
      }
      sample.quality[j] = (sampled[k] as FaceSample).quality[i] as number;
      t[j] = state[map[k * 36 + i] as number] as number;
    }
    views.push({ photo: name, slot: k, cubeFace, sample, truth: t });
  }
}

// ---- 3. Measured colours (calibration numbers) --------------------------------------------------
const med = (a: number[]) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : NaN;
};
const colourStats: Record<string, { n: number; rgb: number[] }> = {};
for (const slotName of ['top', 'side']) {
  for (let c = 0; c < 6; c++) {
    const rs: number[][] = [[], [], []];
    for (const v of views) {
      if ((v.slot === 0) !== (slotName === 'top')) continue;
      for (let i = 0; i < 36; i++) if (v.truth[i] === c) for (let ch = 0; ch < 3; ch++) (rs[ch] as number[]).push(v.sample.rgb[i * 3 + ch] as number);
    }
    colourStats[NAME_OF[LETTERS[c] as string] + ' ' + slotName] = { n: (rs[0] as number[]).length, rgb: rs.map((a) => Math.round(med(a))) };
  }
}
log('median sampled sRGB per colour and face type:');
for (const [k, v] of Object.entries(colourStats)) log('  ', k.padEnd(14), 'n=' + String(v.n).padStart(3), v.rgb.join(','));

// ---- 4. Classifier accuracy over every way of picking one view per cube face --------------------
const byFace: View[][] = [[], [], [], [], [], []];
for (const v of views) (byFace[v.cubeFace] as View[]).push(v);
const PERMS: number[][] = [];
(function build(p: number[], rest: number[]): void {
  if (!rest.length) {
    PERMS.push(p);
    return;
  }
  rest.forEach((v, i) => build([...p, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
})([], [0, 1, 2, 3, 4, 5]);

interface Tally {
  cubes: number;
  stickers: number;
  wrong: number;
  topStickers: number;
  topWrong: number;
  sideStickers: number;
  sideWrong: number;
  confusion: Record<string, number>;
  perCube: number[];
  namesRight: number;
  ms: number[];
}
const newTally = (): Tally => ({ cubes: 0, stickers: 0, wrong: 0, topStickers: 0, topWrong: 0, sideStickers: 0, sideWrong: 0, confusion: {}, perCube: [], namesRight: 0, ms: [] });

function runCombo(combo: View[], tally: Tally, compensate: boolean): void {
  const t0 = performance.now();
  const result = classifyCube(combo.map((v) => v.sample), { compensate });
  tally.ms.push(performance.now() - t0);
  // Colour ids are arbitrary: match them to the true colours by best agreement.
  const agree = new Int32Array(36);
  for (let f = 0; f < 6; f++) for (let i = 0; i < 36; i++) agree[(result.labels[f * 36 + i] as number) * 6 + ((combo[f] as View).truth[i] as number)] += 1;
  let best = PERMS[0] as number[];
  let bestScore = -1;
  for (const p of PERMS) {
    let s = 0;
    for (let k = 0; k < 6; k++) s += agree[k * 6 + (p[k] as number)] as number;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  let wrong = 0;
  for (let f = 0; f < 6; f++) {
    const v = combo[f] as View;
    for (let i = 0; i < 36; i++) {
      const got = best[result.labels[f * 36 + i] as number] as number;
      const want = v.truth[i] as number;
      const isTop = v.slot === 0;
      if (isTop) tally.topStickers++;
      else tally.sideStickers++;
      if (got !== want) {
        wrong++;
        if (isTop) tally.topWrong++;
        else tally.sideWrong++;
        const key = NAME_OF[LETTERS[want] as string] + ' read as ' + NAME_OF[LETTERS[got] as string];
        tally.confusion[key] = (tally.confusion[key] || 0) + 1;
      }
    }
  }
  let namesRight = 0;
  for (let k = 0; k < 6; k++) if (result.names[k] === NAME_OF[LETTERS[best[k] as number] as string]) namesRight++;
  tally.namesRight += namesRight;
  tally.cubes++;
  tally.stickers += 216;
  tally.wrong += wrong;
  tally.perCube.push(wrong);
}

function report(label: string, t: Tally): Record<string, unknown> {
  const pct = (a: number, b: number) => (b ? ((100 * (b - a)) / b).toFixed(2) + '%' : 'n/a');
  const zero = t.perCube.filter((w) => w === 0).length;
  const few = t.perCube.filter((w) => w >= 1 && w <= 3).length;
  const many = t.perCube.filter((w) => w > 3).length;
  const out = {
    label,
    cubes: t.cubes,
    accuracy: pct(t.wrong, t.stickers),
    wrongStickers: t.wrong,
    stickers: t.stickers,
    topFaceAccuracy: pct(t.topWrong, t.topStickers),
    topWrong: t.topWrong,
    topStickers: t.topStickers,
    sideFaceAccuracy: pct(t.sideWrong, t.sideStickers),
    sideWrong: t.sideWrong,
    sideStickers: t.sideStickers,
    cubesWith0Wrong: zero,
    cubesWith1to3Wrong: few,
    cubesWithMoreThan3Wrong: many,
    worstCube: Math.max(0, ...t.perCube),
    namesRightPerCube: (t.namesRight / Math.max(1, t.cubes)).toFixed(2) + ' of 6',
    confusion: t.confusion,
    medianMs: med(t.ms).toFixed(1),
  };
  log(JSON.stringify(out, null, 1));
  return out;
}

const results: Record<string, unknown>[] = [];
for (const compensate of [true, false]) {
  const all = newTally();
  const idx = [0, 0, 0, 0, 0, 0];
  for (;;) {
    runCombo(idx.map((j, f) => (byFace[f] as View[])[j] as View), all, compensate);
    let f = 0;
    while (f < 6) {
      idx[f] = (idx[f] as number) + 1;
      if ((idx[f] as number) < (byFace[f] as View[]).length) break;
      idx[f] = 0;
      f++;
    }
    if (f === 6) break;
  }
  results.push(report('all ' + all.cubes + ' ways of taking one view per face' + (compensate ? '' : ' (no lighting compensation)'), all));
  // The two genuine two-photo sets: opposite corners that together show all six faces.
  for (const pair of [
    ['cube-corner-1', 'cube-corner-3'],
    ['cube-corner-5', 'cube-corner-4'],
  ]) {
    const t = newTally();
    const combo = [0, 1, 2, 3, 4, 5].map((f) => (byFace[f] as View[]).find((v) => pair.includes(v.photo)) as View);
    if (combo.every(Boolean)) {
      runCombo(combo, t, compensate);
      results.push(report('two photos ' + pair.join(' + ') + (compensate ? '' : ' (no lighting compensation)'), t));
    }
  }
}
if (args.includes('--fixtures')) {
  // Sticker samples of the two genuine two-photo sets, as numbers, for the regression test.
  const cubes = [
    ['cube-corner-1', 'cube-corner-3'],
    ['cube-corner-5', 'cube-corner-4'],
  ].map((pair) => {
    const combo = [0, 1, 2, 3, 4, 5].map((f) => (byFace[f] as View[]).find((v) => pair.includes(v.photo)) as View);
    return {
      name: 'reference photos ' + pair.map((p) => p.replace('cube-corner-', '')).join(' and '),
      outlines: mode,
      truth: combo.flatMap((v) => Array.from(v.truth)).join(''),
      colourNames: LETTERS.split('').map((l) => NAME_OF[l]),
      rgb: combo.flatMap((v) => Array.from(v.sample.rgb).map((x) => Math.round(x))),
      quality: combo.flatMap((v) => Array.from(v.sample.quality).map((x) => Math.round(x * 100) / 100)),
    };
  });
  writeFileSync('/workspace/tests/vision-fixtures-real.json', JSON.stringify({ note: 'Sticker colour samples (sRGB means, quality) taken from the reference corner shots of the real cube with snapped outlines, and the colours read by eye. Numbers only; the photos themselves are private and are not in the repository. Regenerate with tools/synth/real-eval.ts --fixtures.', cubes }));
  log('wrote tests/vision-fixtures-real.json');
}
writeFileSync(OUT_DIR + '/real-eval-' + mode + '.json', JSON.stringify({ mode, outlines: outlinesUsed, truth: { covered: 216 - missing, multi, conflicts, counts }, colourStats, results, detectMs: timings }, null, 1));
console.log('mode', mode, 'summary:', results.map((r) => r.label + ': ' + r.accuracy + ' (' + r.wrongStickers + ' wrong)').join(' | '));
