/**
 * Fast loop for tuning the colour model: samples every face photo of a synthetic set once with the
 * true quads (cached in <set>/samples.json), then re-runs classifyCube on the cached samples.
 *   npx tsx tools/synth/quick-eval.ts tmp/vision/synth/v2 [--rebuild]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readImage } from './node-image';
import { classifyCube, faceSampleFromRgb, sampleFace, type Quad } from '../../src/vision/index';
import { compare } from '../../tests/vision-eval-lib';
import { TUNING } from '../../src/vision/classify';

for (const a of process.argv.slice(3)) {
  const m = /^--(\w+)=(.+)$/.exec(a);
  if (m && m[1]! in TUNING) (TUNING as Record<string, number>)[m[1]!] = Number(m[2]);
}

const set = process.argv[2] as string;
const cachePath = set + '/samples.json';
interface Cached {
  name: string;
  condition: string;
  truth: number[];
  rgb: number[];
  quality: number[];
}
let cubes: Cached[];
if (existsSync(cachePath) && !process.argv.includes('--rebuild')) {
  cubes = JSON.parse(readFileSync(cachePath, 'utf8')) as Cached[];
} else {
  const index = JSON.parse(readFileSync(set + '/index.json', 'utf8')) as { cubes: string[] };
  cubes = index.cubes.map((name) => {
    const meta = JSON.parse(readFileSync(set + '/' + name + '/meta.json', 'utf8'));
    const shots = meta.shots.filter((s: { kind: string }) => s.kind === 'face').sort((a: { face: number }, b: { face: number }) => a.face - b.face);
    const samples = shots.map((s: { file: string; quad: number[][] }) => sampleFace(readImage(set + '/' + name + '/' + s.file), s.quad.map((p) => ({ x: p[0] as number, y: p[1] as number })) as Quad));
    return {
      name,
      condition: meta.condition as string,
      truth: meta.state as number[],
      rgb: samples.flatMap((s: { rgb: Float32Array }) => Array.from(s.rgb).map((v) => Math.round(v * 10) / 10)),
      quality: samples.flatMap((s: { quality: Float32Array }) => Array.from(s.quality).map((v) => Math.round(v * 1000) / 1000)),
    };
  });
  writeFileSync(cachePath, JSON.stringify(cubes));
}
const byCond: Record<string, number[]> = {};
let total = 0;
const t0 = performance.now();
for (const cube of cubes) {
  const faces = [0, 1, 2, 3, 4, 5].map((f) => faceSampleFromRgb(cube.rgb.slice(f * 108, f * 108 + 108), cube.quality.slice(f * 36, f * 36 + 36)));
  const wrong = compare(classifyCube(faces), cube.truth).wrong.length;
  (byCond[cube.condition] ||= []).push(wrong);
  total += wrong;
}
const ms = (performance.now() - t0) / cubes.length;
for (const [c, w] of Object.entries(byCond)) console.log(c.padEnd(18), w.map((x) => String(x).padStart(3)).join(' '), ' sum', w.reduce((a, b) => a + b, 0));
const all = Object.values(byCond).flat();
console.log('TOTAL wrong', total, 'of', cubes.length * 216, '(' + (100 * (1 - total / (cubes.length * 216))).toFixed(2) + '%)', '| cubes 0:', all.filter((w) => w === 0).length, '1-3:', all.filter((w) => w >= 1 && w <= 3).length, '>3:', all.filter((w) => w > 3).length, '| classify ms/cube', ms.toFixed(1));
