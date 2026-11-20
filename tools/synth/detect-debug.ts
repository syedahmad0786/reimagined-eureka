/** Lists the outline detection error of every photo of a set: npx tsx tools/synth/detect-debug.ts <set> face|corner [filter] */
import { readFileSync } from 'node:fs';
import { readImage } from './node-image';
import { detectCornerOutline, detectFaceQuad } from '../../src/vision/index';
import { colourfulHull } from '../../src/vision/detect';

const set = process.argv[2] as string;
const kind = process.argv[3] as string;
const filter = process.argv[4] || '';
const index = JSON.parse(readFileSync(set + '/index.json', 'utf8')) as { cubes: string[] };
const errs: number[] = [];
let ms = 0;
for (const name of index.cubes) {
  if (filter && !name.includes(filter)) continue;
  const meta = JSON.parse(readFileSync(set + '/' + name + '/meta.json', 'utf8'));
  const row: string[] = [];
  for (const s of meta.shots.filter((x: { kind: string }) => x.kind === kind)) {
    const img = readImage(set + '/' + name + '/' + s.file);
    const truth = (s.quad || s.outline).map((p: number[]) => ({ x: p[0], y: p[1] }));
    const hull = colourfulHull(img);
    const t0 = performance.now();
    let e = Infinity;
    let conf = 0;
    if (kind === 'face') {
      const det = detectFaceQuad(img);
      conf = det.confidence;
      const side = Math.hypot(truth[1].x - truth[0].x, truth[1].y - truth[0].y);
      for (let rot = 0; rot < 4; rot++) {
        let m = 0;
        for (let k = 0; k < 4; k++) m = Math.max(m, Math.hypot(det.quad[(k + rot) % 4]!.x - truth[k].x, det.quad[(k + rot) % 4]!.y - truth[k].y));
        e = Math.min(e, m / (side / 6));
      }
    } else {
      const det = detectCornerOutline(img);
      conf = det.confidence;
      const width = Math.max(...truth.map((p: { x: number }) => p.x)) - Math.min(...truth.map((p: { x: number }) => p.x));
      e = 0;
      for (let k = 0; k < 7; k++) e = Math.max(e, Math.hypot(det.outline[k]!.x - truth[k].x, det.outline[k]!.y - truth[k].y) / (width / 8.5));
    }
    ms += performance.now() - t0;
    errs.push(e);
    row.push(e.toFixed(2) + (hull ? '' : 'n') + '/' + conf.toFixed(1));
  }
  console.log(name.replace('cube-', '').padEnd(22), row.join('  '));
}
const ok = errs.filter((e) => e <= 0.25).length;
console.log('within 0.25:', ok, 'of', errs.length, '(' + ((100 * ok) / errs.length).toFixed(1) + '%)', 'mean ms', (ms / errs.length).toFixed(0), '(n after the error = no colourful hull found; /x = confidence)');
