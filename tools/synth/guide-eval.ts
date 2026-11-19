/**
 * Simulates the camera path: the user aims the square guide at the face only roughly (wrong size,
 * off centre, slightly turned). How often does locateFaceNear recover the true outline?
 *   npx tsx tools/synth/guide-eval.ts tmp/vision/synth/v3
 */
import { readFileSync } from 'node:fs';
import { readImage } from './node-image';
import { mulberry32 } from './shot';
import { classifyCube, locateFaceNear, sampleFace, type FaceSample, type Quad } from '../../src/vision/index';
import { compare } from '../../tests/vision-eval-lib';

const set = process.argv[2] as string;
const index = JSON.parse(readFileSync(set + '/index.json', 'utf8')) as { cubes: string[] };
const rnd = mulberry32(99);
let ok = 0;
let found = 0;
let n = 0;
let wrongGuide = 0;
let wrongLocated = 0;
const perCube: number[] = [];
for (const name of index.cubes) {
  const meta = JSON.parse(readFileSync(set + '/' + name + '/meta.json', 'utf8'));
  const shots = meta.shots.filter((s: { kind: string }) => s.kind === 'face').sort((a: { face: number }, b: { face: number }) => a.face - b.face);
  const guided: FaceSample[] = [];
  const located: FaceSample[] = [];
  for (const s of shots) {
    const img = readImage(set + '/' + name + '/' + s.file);
    const truth = s.quad.map((p: number[]) => ({ x: p[0], y: p[1] })) as Quad;
    const cx = truth.reduce((a, p) => a + p.x, 0) / 4;
    const cy = truth.reduce((a, p) => a + p.y, 0) / 4;
    const side = Math.hypot(truth[1].x - truth[0].x, truth[1].y - truth[0].y);
    // The guide is an upright square: size within 12 %, centre within 8 % of the side.
    const g = side * (0.88 + 0.24 * rnd());
    const gx = cx + side * 0.16 * (rnd() - 0.5);
    const gy = cy + side * 0.16 * (rnd() - 0.5);
    const guide: Quad = [
      { x: gx - g / 2, y: gy - g / 2 },
      { x: gx + g / 2, y: gy - g / 2 },
      { x: gx + g / 2, y: gy + g / 2 },
      { x: gx - g / 2, y: gy + g / 2 },
    ];
    const res = locateFaceNear(img, guide);
    let e = 0;
    for (let k = 0; k < 4; k++) e = Math.max(e, Math.hypot(res.quad[k]!.x - truth[k]!.x, res.quad[k]!.y - truth[k]!.y));
    n++;
    if (res.found) found++;
    if (e / (side / 6) <= 0.25) ok++;
    guided.push(sampleFace(img, guide));
    located.push(sampleFace(img, res.quad));
  }
  wrongGuide += compare(classifyCube(guided), meta.state).wrong.length;
  const w = compare(classifyCube(located), meta.state).wrong.length;
  wrongLocated += w;
  perCube.push(w);
}
console.log('faces', n, '| accepted detection', found, '| within 0.25 sticker of the true outline (right way up)', ok, '(' + ((100 * ok) / n).toFixed(1) + '%)');
console.log('wrong stickers using the raw guide:', wrongGuide, 'of', index.cubes.length * 216, '(' + (100 * (1 - wrongGuide / (index.cubes.length * 216))).toFixed(2) + '%)');
console.log('wrong stickers after locateFaceNear:', wrongLocated, '(' + (100 * (1 - wrongLocated / (index.cubes.length * 216))).toFixed(2) + '%)', '| cubes 0:', perCube.filter((x) => x === 0).length, '1-3:', perCube.filter((x) => x >= 1 && x <= 3).length, '>3:', perCube.filter((x) => x > 3).length);
