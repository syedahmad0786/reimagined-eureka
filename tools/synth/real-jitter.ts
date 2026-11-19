/**
 * How precisely do the seven outline points have to be placed? Moves every point of the reference
 * photos' outlines by random amounts and counts wrong stickers, with and without snapping.
 *   npx tsx tools/synth/real-jitter.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readImage } from './node-image';
import { loadOutlines, PHOTO_DIR, OUT_DIR } from './real-overlay';
import { mulberry32 } from './shot';
import { assembleCornerShots, classifyCube, cornerFaceletMap, cornerQuads, sampleCornerShot, type CornerOutline, type CornerView, type FaceSample } from '../../src/vision/index';
import { buildEdgeMap, refinePoints, CORNER_OUTSIDE } from '../../src/vision/refine';
import { compare } from '../../tests/vision-eval-lib';

const truthFile = JSON.parse(readFileSync(new URL('./real-truth.json', import.meta.url), 'utf8')) as { photos: Record<string, { view: CornerView; faces: string[][] }> };
const LETTERS = 'OWGYRB';
const state = new Array<number>(216).fill(0);
for (const photo of Object.values(truthFile.photos)) {
  const map = cornerFaceletMap(photo.view);
  for (let k = 0; k < 3; k++) for (let i = 0; i < 36; i++) state[map[k * 36 + i] as number] = LETTERS.indexOf(((photo.faces[k] as string[])[Math.floor(i / 6)] as string)[i % 6] as string);
}
const hand = loadOutlines();
const photos: Record<string, { img: ReturnType<typeof readImage>; edge: ReturnType<typeof buildEdgeMap>; outline: CornerOutline; view: CornerView }> = {};
for (const [name, p] of Object.entries(truthFile.photos)) {
  const img = readImage(PHOTO_DIR + '/' + name + '.jpeg');
  const edge = buildEdgeMap(img, 1600);
  photos[name] = { img, edge, view: p.view, outline: refinePoints(edge, hand[name] as CornerOutline, (q) => cornerQuads(q as CornerOutline), 6, CORNER_OUTSIDE).points as CornerOutline };
}
const pairs = [
  ['cube-corner-1', 'cube-corner-3'],
  ['cube-corner-5', 'cube-corner-4'],
];
const rnd = mulberry32(2026);
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
const rows: Record<string, unknown>[] = [];
for (const sigma of [0, 2, 4, 6, 8, 12, 16]) {
  for (const snap of [false, true]) {
    const wrongs: number[] = [];
    for (let trial = 0; trial < (sigma === 0 ? 1 : 25); trial++)
      for (const pair of pairs) {
        const shots = pair.map((name) => {
          const p = photos[name] as (typeof photos)[string];
          let o = p.outline.map((q) => ({ x: q.x + gauss() * sigma, y: q.y + gauss() * sigma })) as CornerOutline;
          if (snap) o = refinePoints(p.edge, o, (q) => cornerQuads(q as CornerOutline), 6, CORNER_OUTSIDE).points as CornerOutline;
          return { view: p.view, faces: sampleCornerShot(p.img, o) };
        });
        const faces = assembleCornerShots(shots) as FaceSample[];
        wrongs.push(compare(classifyCube(faces), state).wrong.length);
      }
    const row = { sigmaPx: sigma, snapped: snap, trials: wrongs.length, meanWrong: Number((wrongs.reduce((a, b) => a + b, 0) / wrongs.length).toFixed(2)), zeroWrongShare: Number((wrongs.filter((w) => w === 0).length / wrongs.length).toFixed(2)), worst: Math.max(...wrongs) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(OUT_DIR + '/real-jitter.json', JSON.stringify(rows, null, 1));
