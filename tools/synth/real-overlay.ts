/**
 * Draws the corner outlines of the reference photos and rectifies the three faces of each.
 * Usage: npx tsx tools/synth/real-overlay.ts [photo-name ...]
 * Output goes to tmp/vision/real/ (never into git: the photos are private).
 */
import { readFileSync } from 'node:fs';
import { blank, blit, cropScale, drawLine, readImage, writePng, type NodeImage } from './node-image';
import { cornerQuads } from '../../src/vision/corner';
import { applyMat3, squareToQuad } from '../../src/vision/homography';
import { rectifyFace } from '../../src/vision/sample';
import { buildEdgeMap, refinePoints, CORNER_OUTSIDE } from '../../src/vision/refine';
import type { CornerOutline, Quad } from '../../src/vision/types';

export const PHOTO_DIR = process.env.CUBE_REFERENCE_PHOTOS ?? '/home/user/.capy/drive/captain-rubic/handoffs/reference-photos';
export const OUT_DIR = '/workspace/tmp/vision/real';

export function loadOutlines(): Record<string, CornerOutline> {
  const raw = JSON.parse(readFileSync(new URL('./real-outlines.json', import.meta.url), 'utf8')) as { photos: Record<string, number[][]> };
  const out: Record<string, CornerOutline> = {};
  for (const [name, pts] of Object.entries(raw.photos)) out[name] = pts.map((p) => ({ x: p[0] as number, y: p[1] as number })) as CornerOutline;
  return out;
}

export function drawGrid(img: NodeImage, quad: Quad, rgb: number[], scale = 1, ox = 0, oy = 0): void {
  const h = squareToQuad(quad);
  for (let i = 0; i <= 6; i++) {
    const a = applyMat3(h, i / 6, 0);
    const b = applyMat3(h, i / 6, 1);
    const c = applyMat3(h, 0, i / 6);
    const d = applyMat3(h, 1, i / 6);
    drawLine(img, (a.x - ox) * scale, (a.y - oy) * scale, (b.x - ox) * scale, (b.y - oy) * scale, rgb);
    drawLine(img, (c.x - ox) * scale, (c.y - oy) * scale, (d.x - ox) * scale, (d.y - oy) * scale, rgb);
  }
}

if (process.argv[1] && process.argv[1].endsWith('real-overlay.ts')) {
  const outlines = loadOutlines();
  const args = process.argv.slice(2);
  const refine = args.includes('--refine');
  const picked = args.filter((a) => !a.startsWith('--'));
  const names = picked.length ? picked : Object.keys(outlines);
  for (const name of names) {
    let outline = outlines[name] as CornerOutline;
    if (!outline) throw new Error('no outline for ' + name);
    const img = readImage(PHOTO_DIR + '/' + name + '.jpeg');
    if (refine) {
      const edge = buildEdgeMap(img, 1600);
      const r = refinePoints(edge, outline, (p) => cornerQuads(p as CornerOutline), 6, CORNER_OUTSIDE);
      console.log(name, 'refined score', r.score.toFixed(4), JSON.stringify(r.points.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])));
      outline = r.points as CornerOutline;
    }
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    const x0 = Math.max(0, Math.min(...xs) - 30);
    const y0 = Math.max(0, Math.min(...ys) - 30);
    const w = Math.min(img.width, Math.max(...xs) + 30) - x0;
    const h = Math.min(img.height, Math.max(...ys) + 30) - y0;
    const scale = 1.4;
    const crop = cropScale(img, x0, y0, w, h, scale);
    const quads = cornerQuads(outline);
    const colours = [
      [255, 0, 255],
      [0, 255, 255],
      [255, 255, 255],
    ];
    quads.forEach((q, i) => drawGrid(crop, q, colours[i] as number[], scale, x0, y0));
    writePng(OUT_DIR + '/' + name + '-overlay.png', crop);
    const size = 384;
    const strip = blank(size * 3 + 40, size + 20, [40, 40, 40]);
    quads.forEach((q, i) => {
      const r = rectifyFace(img, q, size);
      for (let k = 1; k < 6; k++) {
        drawLine(r, (k * size) / 6, 0, (k * size) / 6, size - 1, [0, 0, 0]);
        drawLine(r, 0, (k * size) / 6, size - 1, (k * size) / 6, [0, 0, 0]);
      }
      blit(strip, r, 10 + i * (size + 10), 10);
      writePng(OUT_DIR + '/' + name + '-face' + i + '.png', r);
    });
    writePng(OUT_DIR + '/' + name + '-faces.png', strip);
    console.log(name, 'crop origin', x0, y0, 'scale', scale);
  }
}
