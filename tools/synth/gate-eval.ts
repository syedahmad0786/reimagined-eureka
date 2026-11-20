/**
 * Measurements behind the thresholds of automatic capture (GATES in src/vision/live.ts), on stills in Node.
 *   npx tsx tools/synth/gate-eval.ts tmp/vision/synth/v3 [--real]
 * 1. Shape of the true face outlines: how many straight-on photos the shape rules would let through.
 * 2. The live face finder on corner shots: a side seen at a corner angle must never pass in 'face' mode.
 * 3. The live corner finder on straight-on photos: one side must never pass in 'corner' mode.
 * 4. The true corner outlines against the corner rules.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { readImage } from './node-image';
import { findCorner, findFace, guideCornerOutline } from '../../src/vision/detect';
import { centredSquareQuad } from '../../src/vision/homography';
import { downscaleRgb } from '../../src/vision/refine';
import { GATES, assessCorner, assessFace, faceShape } from '../../src/vision/live';
import type { ImageLike, Point } from '../../src/vision/types';

function shrink(image: ImageLike, maxSide: number): ImageLike {
  const s = downscaleRgb(image, maxSide);
  const data = new Uint8ClampedArray(s.width * s.height * 4);
  for (let i = 0; i < s.width * s.height; i++) {
    data[i * 4] = s.rgb[i * 3] as number;
    data[i * 4 + 1] = s.rgb[i * 3 + 1] as number;
    data[i * 4 + 2] = s.rgb[i * 3 + 2] as number;
    data[i * 4 + 3] = 255;
  }
  return { width: s.width, height: s.height, data };
}
const args = process.argv.slice(2);
const set = args.find((a) => !a.startsWith('--')) || 'tmp/vision/synth/v3';
const cubes = (JSON.parse(readFileSync(set + '/index.json', 'utf8')) as { cubes: string[] }).cubes;
const pct = (a: number, b: number): string => a + ' of ' + b + ' (' + ((100 * a) / Math.max(1, b)).toFixed(1) + '%)';
const quantiles = (v: number[]): string => {
  const s = v.slice().sort((a, b) => a - b);
  const q = (p: number): string => (s[Math.min(s.length - 1, Math.floor(p * s.length))] as number).toFixed(2);
  return 'median ' + q(0.5) + ', 90% ' + q(0.9) + ', 99% ' + q(0.99) + ', max ' + (s[s.length - 1] as number).toFixed(2);
};

const shapes: Record<string, { taper: number[]; aspect: number[]; skew: number[]; roll: number[]; pass: number; n: number }> = {};
const codes: Record<string, number> = {};
let faceOnCorner = { n: 0, pass: 0, shapePass: 0, conf: [] as number[] };
let cornerOnFace = { n: 0, pass: 0, found: 0, conf: [] as number[] };
let cornerTruth = { n: 0, pass: 0, codes: {} as Record<string, number> };
const view = (im: ImageLike) => ({ x0: 0, y0: 0, x1: im.width, y1: im.height });

for (const cube of cubes) {
  const meta = JSON.parse(readFileSync(set + '/' + cube + '/meta.json', 'utf8')) as { condition: string; shots: { kind: string; file: string; quad?: number[][]; outline?: number[][]; params: { camera: { tiltDeg: number } } }[] };
  for (const shot of meta.shots) {
    const img = readImage(set + '/' + cube + '/' + shot.file);
    const small = shrink(img, 320);
    const k = small.width / img.width;
    if (shot.kind === 'face') {
      const quad = (shot.quad as number[][]).map((p) => ({ x: p[0] as number, y: p[1] as number }));
      const s = faceShape(quad);
      const t = (shapes[meta.condition] ??= { taper: [], aspect: [], skew: [], roll: [], pass: 0, n: 0 });
      t.taper.push(s.taper);
      t.aspect.push(s.aspect);
      t.skew.push(s.skewDeg);
      t.roll.push(Math.abs(s.rollDeg));
      t.n++;
      // Shape rules only: no guide, and the size rule is not what is measured here.
      const a = assessFace(quad, 1, null, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 });
      if (a.ok || a.code === 'too-far') t.pass++;
      else codes[a.code] = (codes[a.code] || 0) + 1;
      // 3. corner finder on a straight-on photo
      const g = guideCornerOutline(small.width / 2, small.height / 2, 0.8 * small.width);
      const c = findCorner(small, { quick: true, near: { cx: small.width / 2, cy: small.height / 2, size: 0.8 * small.width } });
      cornerOnFace.n++;
      if (c.found) {
        cornerOnFace.found++;
        cornerOnFace.conf.push(c.confidence);
        if (assessCorner(c.outline, c.confidence, g, view(small)).ok) cornerOnFace.pass++;
      }
    } else {
      // 2. face finder on a corner shot
      const g = centredSquareQuad(small.width, small.height, 0.8);
      const f = findFace(small, { quick: true, near: { cx: small.width / 2, cy: small.height / 2, size: 0.8 * small.width } });
      faceOnCorner.n++;
      if (f.found) {
        faceOnCorner.conf.push(f.confidence);
        const a = assessFace(f.quad, f.confidence, g, view(small));
        if (a.ok) faceOnCorner.pass++;
        const sh = assessFace(f.quad, 1, null, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 });
        if ((sh.ok || sh.code === 'too-far') && f.confidence >= GATES.confidence) faceOnCorner.shapePass++;
      }
      // 4. the true corner outline
      const o = (shot.outline as number[][]).map((p) => ({ x: (p[0] as number) * k, y: (p[1] as number) * k }));
      const a = assessCorner(o, 1, null, view(small));
      cornerTruth.n++;
      if (a.ok) cornerTruth.pass++;
      else cornerTruth.codes[a.code] = (cornerTruth.codes[a.code] || 0) + 1;
    }
  }
}
console.log('1. True face outlines against the shape rules (taper <= ' + GATES.face.taper + ', aspect <= ' + GATES.face.aspect + ', skew <= ' + GATES.face.skewDeg + ', roll <= ' + GATES.face.rollDeg + ')');
for (const [cond, t] of Object.entries(shapes)) console.log('   ' + cond.padEnd(16) + ' pass ' + pct(t.pass, t.n) + ' | taper ' + quantiles(t.taper) + ' | aspect ' + quantiles(t.aspect) + ' | skew ' + quantiles(t.skew) + ' | roll ' + quantiles(t.roll));
console.log('   refused because: ' + JSON.stringify(codes));
console.log('2. Live face finder on corner shots: passes all face rules ' + pct(faceOnCorner.pass, faceOnCorner.n) + '; passes shape and confidence rules alone ' + pct(faceOnCorner.shapePass, faceOnCorner.n) + '; confidence of what it found: ' + quantiles(faceOnCorner.conf));
console.log('3. Live corner finder on straight-on photos: found something ' + pct(cornerOnFace.found, cornerOnFace.n) + ', passes the corner rules ' + pct(cornerOnFace.pass, cornerOnFace.n) + '; confidence: ' + quantiles(cornerOnFace.conf));
console.log('4. True corner outlines against the corner rules: pass ' + pct(cornerTruth.pass, cornerTruth.n) + ', refused because ' + JSON.stringify(cornerTruth.codes));

if (args.includes('--real')) {
  const dir = process.env.HOME + '/.capy/drive/captain-rubic/handoffs/reference-photos/';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jpeg'))) {
    const small = shrink(readImage(dir + file), 320);
    // The phone view is 3:4; a 747x1600 photo is taller, so judge against the centred 3:4 part as the camera would show it.
    const vh = (small.width * 4) / 3;
    const v = { x0: 0, y0: (small.height - vh) / 2, x1: small.width, y1: (small.height + vh) / 2 };
    const near = { cx: small.width / 2, cy: small.height / 2, size: 0.8 * small.width };
    const f = findFace(small, { quick: true, near });
    const g = centredSquareQuad(small.width, small.height, 0.8);
    const a = assessFace(f.quad, f.confidence, g, v);
    const c = findCorner(small, { quick: true, near });
    const ac = assessCorner(c.outline, c.confidence, guideCornerOutline(near.cx, near.cy, near.size), v);
    console.log('real ' + file + ': face mode -> found ' + f.found + ' conf ' + f.confidence.toFixed(2) + ' verdict ' + JSON.stringify(a) + ' | corner mode -> conf ' + c.confidence.toFixed(2) + ' verdict ' + JSON.stringify(ac));
  }
}
