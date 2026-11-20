/** Contact sheet of images: npx tsx tools/synth/montage.ts out.png cols scale a.jpg b.png ... */
import { blank, blit, readImage, writePng, type NodeImage } from './node-image';

function shrink(src: NodeImage, scale: number): NodeImage {
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = blank(w, h);
  const acc = new Float32Array(w * h * 3);
  const cnt = new Float32Array(w * h);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const t = Math.min(h - 1, Math.floor(y * scale)) * w + Math.min(w - 1, Math.floor(x * scale));
      const o = (y * src.width + x) * 4;
      acc[t * 3] += src.data[o] as number;
      acc[t * 3 + 1] += src.data[o + 1] as number;
      acc[t * 3 + 2] += src.data[o + 2] as number;
      cnt[t] += 1;
    }
  for (let t = 0; t < w * h; t++) {
    const c = cnt[t] || 1;
    out.data[t * 4] = (acc[t * 3] as number) / c;
    out.data[t * 4 + 1] = (acc[t * 3 + 1] as number) / c;
    out.data[t * 4 + 2] = (acc[t * 3 + 2] as number) / c;
  }
  return out;
}

const [outPath, colsArg, scaleArg, ...paths] = process.argv.slice(2);
const cols = Number(colsArg);
const scale = Number(scaleArg);
const tiles = paths.map((p) => shrink(readImage(p), scale));
const tw = Math.max(...tiles.map((t) => t.width));
const th = Math.max(...tiles.map((t) => t.height));
const rows = Math.ceil(tiles.length / cols);
const sheet = blank(cols * (tw + 4) + 4, rows * (th + 4) + 4, [30, 30, 30]);
tiles.forEach((t, i) => blit(sheet, t, 4 + (i % cols) * (tw + 4), 4 + Math.floor(i / cols) * (th + 4)));
writePng(outPath as string, sheet);
