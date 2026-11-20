/**
 * Debug view of one synthetic cube: rectifies its six face photos with the true quads, marks the
 * stickers the classifier got wrong, and prints the wrong samples.
 *   npx tsx tools/synth/inspect-cube.ts tmp/vision/synth/v1/cube-000-easy [out.png]
 * With --list <set dir> it prints the wrong-sticker count of every cube instead.
 */
import { readFileSync } from 'node:fs';
import { blank, blit, drawLine, readImage, writePng } from './node-image';
import { classifyCube, rectifyFace, sampleFace, type FaceSample, type Quad } from '../../src/vision/index';
import { compare } from '../../tests/vision-eval-lib';

function run(dir: string) {
  const meta = JSON.parse(readFileSync(dir + '/meta.json', 'utf8'));
  const shots = meta.shots.filter((s: { kind: string }) => s.kind === 'face').sort((a: { face: number }, b: { face: number }) => a.face - b.face);
  const images = shots.map((s: { file: string }) => readImage(dir + '/' + s.file));
  const quads: Quad[] = shots.map((s: { quad: number[][] }) => s.quad.map((p) => ({ x: p[0] as number, y: p[1] as number })) as Quad);
  const samples: FaceSample[] = images.map((img: ReturnType<typeof readImage>, i: number) => sampleFace(img, quads[i] as Quad));
  const result = classifyCube(samples);
  const cmp = compare(result, meta.state);
  return { meta, images, quads, samples, result, cmp };
}

if (process.argv[2] === '--list') {
  const set = process.argv[3] as string;
  const index = JSON.parse(readFileSync(set + '/index.json', 'utf8')) as { cubes: string[] };
  console.log(index.cubes.map((c) => c.replace('cube-', '') + ':' + run(set + '/' + c).cmp.wrong.length).join('  '));
} else {
  const dir = process.argv[2] as string;
  const { meta, images, quads, samples, result, cmp } = run(dir);
  const size = 240;
  const sheet = blank(6 * (size + 6) + 6, size + 12, [40, 40, 40]);
  for (let f = 0; f < 6; f++) {
    const r = rectifyFace(images[f], quads[f] as Quad, size);
    for (const i of cmp.wrong.filter((w) => Math.floor(w / 36) === f)) {
      const row = Math.floor((i % 36) / 6);
      const col = i % 6;
      const x = (col * size) / 6;
      const y = (row * size) / 6;
      drawLine(r, x + 3, y + 3, x + size / 6 - 3, y + size / 6 - 3, [255, 0, 255], 2);
      drawLine(r, x + size / 6 - 3, y + 3, x + 3, y + size / 6 - 3, [255, 0, 255], 2);
    }
    blit(sheet, r, 6 + f * (size + 6), 6);
  }
  writePng(process.argv[3] || dir + '/inspect.png', sheet);
  console.log(meta.name, 'wrong', cmp.wrong.length, 'names', result.names.join(','));
  for (const i of cmp.wrong.slice(0, 14)) {
    const s = samples[Math.floor(i / 36)] as FaceSample;
    const j = i % 36;
    console.log('  face', 'URFDLB'[Math.floor(i / 36)], 'cell', Math.floor(j / 6), j % 6, 'rgb', [0, 1, 2].map((c) => Math.round(s.rgb[j * 3 + c] as number)).join(','), 'q', (s.quality[j] as number).toFixed(2), 'true', meta.colourNames[meta.state[i]], 'got', meta.colourNames[cmp.mapping[result.labels[i] as number] as number], 'conf', (result.confidence[i] as number).toFixed(2));
  }
}
