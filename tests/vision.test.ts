/**
 * Fast regression tests for src/vision. No browser and no image files: fixtures are sticker samples
 * stored as numbers, and test images are drawn in memory. The full accuracy run over the synthetic
 * photo set is tests/vision-eval.ts.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { faceletCubie } from '../src/cube/geometry';
import { balancedAssign } from '../src/vision/assign';
import { applyMat3, quadToSquare, squareToQuad } from '../src/vision/homography';
import {
  TWO_SHOT_VIEWS,
  allCornerViews,
  assembleCornerShots,
  classifyCube,
  cornerFaceletMap,
  detectCornerOutline,
  detectFaceQuad,
  faceSampleFromRgb,
  sampleCornerShot,
  sampleFace,
  snapQuad,
  type Classification,
  type CornerOutline,
  type FaceSample,
  type ImageLike,
  type Quad,
} from '../src/vision/index';
import { projectCornerView } from '../src/vision/detect';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERMS: number[][] = [];
(function build(p: number[], rest: number[]): void {
  if (!rest.length) {
    PERMS.push(p);
    return;
  }
  rest.forEach((v, i) => build([...p, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
})([], [0, 1, 2, 3, 4, 5]);

/** Wrong stickers after matching the arbitrary colour ids to the truth in the best possible way. */
function wrongCount(result: Classification, truth: ArrayLike<number>): number {
  const agree = new Int32Array(36);
  for (let i = 0; i < 216; i++) agree[(result.labels[i] as number) * 6 + Number(truth[i])] += 1;
  let best = 0;
  for (const p of PERMS) {
    let s = 0;
    for (let k = 0; k < 6; k++) s += agree[k * 6 + (p[k] as number)] as number;
    best = Math.max(best, s);
  }
  return 216 - best;
}

function facesFromFlat(rgb: number[], quality?: number[]): FaceSample[] {
  return [0, 1, 2, 3, 4, 5].map((f) => faceSampleFromRgb(rgb.slice(f * 108, f * 108 + 108), quality ? quality.slice(f * 36, f * 36 + 36) : undefined));
}

function expectBalanced(result: Classification): void {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const l of result.labels) counts[l] = (counts[l] as number) + 1;
  expect(counts).toEqual([36, 36, 36, 36, 36, 36]);
  expect(result.labels.length).toBe(216);
  expect(result.confidence.length).toBe(216);
  expect(result.costs.length).toBe(216 * 6);
  expect(result.palette.length).toBe(6);
  expect(new Set(result.palette).size).toBe(6);
  for (const c of result.confidence) expect(c >= 0 && c <= 1).toBe(true);
}

describe('balancedAssign', () => {
  it('finds the optimum of small problems (checked by brute force) and keeps every label count equal', () => {
    const rnd = rng(3);
    for (let trial = 0; trial < 60; trial++) {
      const n = 6;
      const k = 3;
      const cost = new Float64Array(n * k);
      for (let i = 0; i < cost.length; i++) cost[i] = rnd();
      const labels = new Uint8Array(n);
      const total = balancedAssign(cost, n, k, labels, false);
      let best = Infinity;
      const walk = (i: number, used: number[], sum: number): void => {
        if (i === n) {
          best = Math.min(best, sum);
          return;
        }
        for (let c = 0; c < k; c++) {
          if ((used[c] as number) >= 2) continue;
          used[c] = (used[c] as number) + 1;
          walk(i + 1, used, sum + (cost[i * k + c] as number));
          used[c] = (used[c] as number) - 1;
        }
      };
      walk(0, [0, 0, 0], 0);
      expect(total).toBeCloseTo(best, 9);
      expect([0, 1, 2].map((c) => labels.filter((l) => l === c).length)).toEqual([2, 2, 2]);
    }
  });

  it('gives 36 of each for 216 samples even when every sample prefers one label', () => {
    const cost = new Float64Array(216 * 6);
    const rnd = rng(9);
    for (let i = 0; i < 216; i++) for (let c = 0; c < 6; c++) cost[i * 6 + c] = c === 0 ? rnd() * 0.1 : 1 + rnd();
    const labels = new Uint8Array(216);
    balancedAssign(cost, 216, 6, labels, false);
    for (let c = 0; c < 6; c++) expect(labels.filter((l) => l === c).length).toBe(36);
  });
});

describe('homography', () => {
  it('maps the unit square onto the quad and back', () => {
    const quad: Quad = [
      { x: 120, y: 80 },
      { x: 610, y: 130 },
      { x: 560, y: 640 },
      { x: 90, y: 520 },
    ];
    const h = squareToQuad(quad);
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    corners.forEach((c, i) => {
      const p = applyMat3(h, c[0] as number, c[1] as number);
      expect(p.x).toBeCloseTo((quad[i] as { x: number }).x, 6);
      expect(p.y).toBeCloseTo((quad[i] as { y: number }).y, 6);
    });
    const inv = quadToSquare(quad);
    const mid = applyMat3(h, 0.3, 0.7);
    const back = applyMat3(inv, mid.x, mid.y);
    expect(back.x).toBeCloseTo(0.3, 6);
    expect(back.y).toBeCloseTo(0.7, 6);
  });
});

describe('corner views', () => {
  it('lists 24 views and maps the URF view onto U, F and R unchanged', () => {
    expect(allCornerViews().length).toBe(24);
    const map = cornerFaceletMap({ top: 0, left: 2, right: 1 });
    for (let i = 0; i < 36; i++) {
      expect(map[i]).toBe(i); // U
      expect(map[36 + i]).toBe(2 * 36 + i); // F
      expect(map[72 + i]).toBe(36 + i); // R
    }
  });

  it('keeps stickers that touch in the photo on the same cubie, for every view', () => {
    const cubieOf = (index: number) => faceletCubie(Math.floor(index / 36), Math.floor((index % 36) / 6), index % 6).join(',');
    for (const view of allCornerViews()) {
      const map = cornerFaceletMap(view);
      const faces = new Set(Array.from(map, (v) => Math.floor(v / 36)));
      expect([...faces].sort()).toEqual([view.top, view.left, view.right].sort());
      expect(new Set(map).size).toBe(108);
      for (let c = 0; c < 6; c++) {
        // top row 5 meets left row 0; top column 5 meets right row 0 (reversed); left column 5 meets right column 0.
        expect(cubieOf(map[5 * 6 + c] as number)).toBe(cubieOf(map[36 + c] as number));
        expect(cubieOf(map[c * 6 + 5] as number)).toBe(cubieOf(map[72 + (5 - c)] as number));
        expect(cubieOf(map[36 + c * 6 + 5] as number)).toBe(cubieOf(map[72 + c * 6] as number));
      }
    }
  });

  it('covers all 216 facelets with the two standard shots', () => {
    const seen = new Set<number>();
    for (const v of TWO_SHOT_VIEWS) for (const i of cornerFaceletMap(v)) seen.add(i);
    expect(seen.size).toBe(216);
  });
});

/** Draws a face (or any quads) into an RGBA image: flat stickers with dark gaps, shading across the face and an optional glare disc. */
function drawFaces(
  width: number,
  height: number,
  background: [number, number, number],
  faces: { quad: Quad; colours: number[][]; shade?: (u: number, v: number) => number }[],
  glare?: { x: number; y: number; r: number },
): ImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  const inverses = faces.map((f) => quadToSquare(f.quad));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let rgb: number[] = background;
      for (let k = 0; k < faces.length; k++) {
        const p = applyMat3(inverses[k] as ReturnType<typeof quadToSquare>, x + 0.5, y + 0.5);
        if (p.x < 0 || p.x >= 1 || p.y < 0 || p.y >= 1) continue;
        const cu = p.x * 6;
        const cv = p.y * 6;
        const fu = cu - Math.floor(cu);
        const fv = cv - Math.floor(cv);
        const face = faces[k] as (typeof faces)[number];
        if (fu < 0.07 || fu > 0.93 || fv < 0.07 || fv > 0.93) rgb = [18, 18, 20];
        else {
          const s = face.shade ? face.shade(p.x, p.y) : 1;
          rgb = (face.colours[Math.floor(cv) * 6 + Math.floor(cu)] as number[]).map((c) => c * s);
        }
        break;
      }
      if (glare && Math.hypot(x - glare.x, y - glare.y) < glare.r) rgb = [255, 255, 255];
      const o = (y * width + x) * 4;
      data[o] = rgb[0] as number;
      data[o + 1] = rgb[1] as number;
      data[o + 2] = rgb[2] as number;
      data[o + 3] = 255;
    }
  return { width, height, data };
}

const BASE: number[][] = [
  [253, 129, 35],
  [220, 223, 218],
  [66, 209, 82],
  [238, 220, 50],
  [202, 57, 56],
  [34, 112, 184],
];

describe('sampleFace', () => {
  const rnd = rng(11);
  const ids = Array.from({ length: 36 }, () => Math.floor(rnd() * 6));
  const quad: Quad = [
    { x: 70, y: 60 },
    { x: 330, y: 84 },
    { x: 318, y: 352 },
    { x: 52, y: 318 },
  ];
  it('reads every sticker of a perspective face and is not fooled by a glare spot', () => {
    // The glare disc covers about a third of sticker (row 2, col 3) and clips its neighbours.
    const h = squareToQuad(quad);
    const centre = applyMat3(h, 3.5 / 6, 2.5 / 6);
    const img = drawFaces(400, 400, [200, 200, 205], [{ quad, colours: ids.map((i) => BASE[i] as number[]) }], { x: centre.x + 9, y: centre.y + 6, r: 13 });
    const s = sampleFace(img, quad);
    for (let i = 0; i < 36; i++) {
      const want = BASE[ids[i] as number] as number[];
      for (let c = 0; c < 3; c++) expect(Math.abs((s.rgb[i * 3 + c] as number) - (want[c] as number))).toBeLessThan(6);
    }
    const glared = 2 * 6 + 3;
    const others = Array.from(s.quality).filter((_, i) => i !== glared);
    expect(s.quality[glared] as number).toBeLessThan(Math.min(...others));
    expect(Math.min(...others)).toBeGreaterThan(0.9);
  });

  it('returns samples without throwing when the quad leaves the image', () => {
    const img = drawFaces(64, 64, [90, 90, 90], []);
    const s = sampleFace(img, [
      { x: -40, y: -40 },
      { x: 200, y: -10 },
      { x: 180, y: 190 },
      { x: -20, y: 160 },
    ]);
    expect(s.rgb.length).toBe(108);
    expect(Math.min(...s.quality)).toBe(0);
  });
});

/** A random colouring with 36 of each colour and per-face lighting: gain, colour cast, loss of saturation, a gradient, and noise. */
function litCube(seed: number, palette: number[][], harsh: number): { faces: FaceSample[]; truth: number[] } {
  const rnd = rng(seed);
  const truth = Array.from({ length: 216 }, (_, i) => i % 6);
  for (let i = 215; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [truth[i], truth[j]] = [truth[j] as number, truth[i] as number];
  }
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const faces: FaceSample[] = [];
  for (let f = 0; f < 6; f++) {
    const gain = 1 - harsh * 0.55 * rnd();
    const cast = [1 - harsh * 0.25 * rnd(), 1 - harsh * 0.12 * rnd(), 1 - harsh * 0.25 * rnd()];
    const veil = harsh * 60 * rnd();
    const gx = harsh * 0.5 * (rnd() - 0.5);
    const rgb: number[] = [];
    for (let i = 0; i < 36; i++) {
      const p = palette[truth[f * 36 + i] as number] as number[];
      const shade = gain * (1 + gx * ((i % 6) / 5 - 0.5));
      for (let c = 0; c < 3; c++) rgb.push(Math.max(0, Math.min(255, ((p[c] as number) * (cast[c] as number) + veil) * shade * (255 / (255 + veil)) + gauss() * 3)));
    }
    faces.push(faceSampleFromRgb(rgb));
  }
  return { faces, truth };
}

describe('classifyCube', () => {
  it('labels cubes lit differently on every face, with exactly 36 stickers per colour', () => {
    let wrong = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const { faces, truth } = litCube(seed, BASE, 1);
      const result = classifyCube(faces);
      expectBalanced(result);
      wrong += wrongCount(result, truth);
    }
    expect(wrong).toBe(0);
  });

  it('names the usual six colours', () => {
    const { faces, truth } = litCube(77, BASE, 0.4);
    const result = classifyCube(faces);
    const names = ['orange', 'white', 'green', 'yellow', 'red', 'blue'];
    for (let i = 0; i < 216; i++) expect(result.names[result.labels[i] as number]).toBe(names[truth[i] as number]);
  });

  it('works for a colour scheme without the usual colours (pink, purple, black, lime, cyan, white)', () => {
    const odd = [
      [244, 143, 177],
      [240, 240, 240],
      [182, 224, 36],
      [123, 47, 191],
      [28, 28, 30],
      [25, 195, 214],
    ];
    let wrong = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { faces, truth } = litCube(100 + seed, odd, 0.6);
      const result = classifyCube(faces);
      expectBalanced(result);
      wrong += wrongCount(result, truth);
    }
    expect(wrong).toBe(0);
  });

  it('handles a solved cube and degenerate input without throwing', () => {
    const solved = [0, 1, 2, 3, 4, 5].map((f) => faceSampleFromRgb(Array.from({ length: 36 }, () => BASE[f] as number[]).flat()));
    const r = classifyCube(solved);
    expectBalanced(r);
    for (let f = 0; f < 6; f++) expect(new Set(r.labels.slice(f * 36, f * 36 + 36)).size).toBe(1);
    const grey = [0, 1, 2, 3, 4, 5].map(() => faceSampleFromRgb(new Array(108).fill(128)));
    expectBalanced(classifyCube(grey));
    expect(() => classifyCube(solved.slice(0, 5))).toThrow();
  });

  it('gives its lowest confidence to the stickers it gets wrong on a hard cube', () => {
    const { faces, truth } = litCube(5, BASE, 1);
    // Corrupt three stickers so that they really are ambiguous: halfway between orange and red.
    for (const i of [3, 50, 140]) {
      const f = faces[Math.floor(i / 36)] as FaceSample;
      f.rgb.set([228, 93, 45], (i % 36) * 3);
    }
    const result = classifyCube(faces);
    const order = Array.from({ length: 216 }, (_, i) => i).sort((a, b) => (result.confidence[a] as number) - (result.confidence[b] as number));
    const lowest = new Set(order.slice(0, 12));
    for (const i of [3, 50, 140]) expect(lowest.has(i)).toBe(true);
    expect(wrongCount(result, truth)).toBeLessThanOrEqual(3);
  });

  it('runs in well under a second', () => {
    const { faces } = litCube(9, BASE, 1);
    classifyCube(faces);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) classifyCube(faces);
    expect((performance.now() - t0) / 5).toBeLessThan(250);
  });
});

describe('recorded samples', () => {
  const synthPath = new URL('./vision-fixtures.json', import.meta.url);
  const realPath = new URL('./vision-fixtures-real.json', import.meta.url);

  it.skipIf(!existsSync(synthPath))('synthetic cubes, one per condition, read no worse than when recorded', () => {
    const data = JSON.parse(readFileSync(synthPath, 'utf8')) as { cubes: { name: string; condition: string; wrongWhenRecorded: number; truth: string; rgb: number[]; quality: number[] }[] };
    expect(data.cubes.length).toBeGreaterThanOrEqual(8);
    for (const cube of data.cubes) {
      const result = classifyCube(facesFromFlat(cube.rgb, cube.quality));
      expectBalanced(result);
      expect(wrongCount(result, Array.from(cube.truth, Number)), cube.name).toBeLessThanOrEqual(cube.wrongWhenRecorded);
    }
  });

  it.skipIf(!existsSync(realPath))('the two two-photo sets of the real cube read with no wrong sticker', () => {
    const data = JSON.parse(readFileSync(realPath, 'utf8')) as { cubes: { name: string; truth: string; colourNames: string[]; rgb: number[]; quality: number[] }[] };
    expect(data.cubes.length).toBe(2);
    for (const cube of data.cubes) {
      const result = classifyCube(facesFromFlat(cube.rgb, cube.quality));
      expectBalanced(result);
      expect(wrongCount(result, Array.from(cube.truth, Number)), cube.name).toBe(0);
      for (let i = 0; i < 216; i++) expect(result.names[result.labels[i] as number]).toBe(cube.colourNames[Number(cube.truth[i])]);
    }
  });
});

describe('outline detection', () => {
  const rnd = rng(21);
  const ids = Array.from({ length: 36 }, () => Math.floor(rnd() * 6));
  it('never throws and reports no confidence on images without a cube', () => {
    const blank = drawFaces(80, 60, [128, 128, 128], []);
    const a = detectFaceQuad(blank);
    expect(a.confidence).toBeLessThan(0.2);
    expect(a.quad.length).toBe(4);
    const tiny: ImageLike = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    expect(detectFaceQuad(tiny).confidence).toBe(0);
    expect(detectCornerOutline(tiny).confidence).toBe(0);
    expect(detectCornerOutline(blank).outline.length).toBe(7);
  });

  it('finds a face drawn in an image', () => {
    const quad: Quad = [
      { x: 96, y: 150 },
      { x: 372, y: 138 },
      { x: 384, y: 420 },
      { x: 104, y: 428 },
    ];
    const img = drawFaces(480, 640, [205, 205, 210], [{ quad, colours: ids.map((i) => BASE[i] as number[]), shade: (u) => 0.8 + 0.2 * u }]);
    const det = detectFaceQuad(img);
    const cell = 280 / 6;
    let worst = Infinity;
    for (let rot = 0; rot < 4; rot++) {
      let e = 0;
      for (let k = 0; k < 4; k++) e = Math.max(e, Math.hypot(det.quad[(k + rot) % 4]!.x - quad[k]!.x, det.quad[(k + rot) % 4]!.y - quad[k]!.y));
      worst = Math.min(worst, e);
    }
    expect(worst).toBeLessThan(cell * 0.25);
    expect(det.confidence).toBeGreaterThan(0.5);
    // Snapping a slightly wrong outline brings it back.
    const off = quad.map((p, i) => ({ x: p.x + (i % 2 ? 5 : -4), y: p.y + (i < 2 ? 4 : -5) })) as Quad;
    const snapped = snapQuad(img, off);
    // (The drawn gaps are 6 px wide, so an outline can sit anywhere within the outer gap.)
    for (let k = 0; k < 4; k++) expect(Math.hypot(snapped[k]!.x - quad[k]!.x, snapped[k]!.y - quad[k]!.y)).toBeLessThan(6);
  });

  it('finds a corner view drawn in an image and reads its three faces', () => {
    const shape = projectCornerView((40 * Math.PI) / 180, (5 * Math.PI) / 180, (-3 * Math.PI) / 180, 6.5);
    const outline = shape.map((p) => ({ x: 240 + p.x * 300, y: 330 + p.y * 300 })) as CornerOutline;
    const q: [Quad, Quad, Quad] = [
      [outline[1], outline[2], outline[0], outline[6]],
      [outline[6], outline[0], outline[4], outline[5]],
      [outline[0], outline[2], outline[3], outline[4]],
    ];
    const cols = [0, 1, 2].map((k) => Array.from({ length: 36 }, (_, i) => BASE[(ids[i] as number) === k ? (k + 3) % 6 : ((ids[i] as number) + k) % 6] as number[]));
    const img = drawFaces(
      480,
      640,
      [212, 212, 214],
      q.map((quad, k) => ({ quad, colours: cols[k] as number[][], shade: () => [1, 0.72, 0.6][k] as number })),
    );
    const det = detectCornerOutline(img);
    for (let k = 0; k < 7; k++) expect(Math.hypot(det.outline[k]!.x - outline[k]!.x, det.outline[k]!.y - outline[k]!.y)).toBeLessThan(8);
    const faces = sampleCornerShot(img, det.outline);
    for (let k = 0; k < 3; k++)
      for (let i = 0; i < 36; i++) {
        const want = ((cols[k] as number[][])[i] as number[]).map((c) => c * ([1, 0.72, 0.6][k] as number));
        for (let c = 0; c < 3; c++) expect(Math.abs((faces[k]!.rgb[i * 3 + c] as number) - (want[c] as number))).toBeLessThan(8);
      }
    const assembled = assembleCornerShots([{ view: TWO_SHOT_VIEWS[0], faces }]);
    expect(assembled.filter(Boolean).length).toBe(3);
  });
});
