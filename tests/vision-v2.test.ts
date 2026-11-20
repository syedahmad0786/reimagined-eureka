/**
 * Tests of the version 2 pieces of src/vision that run without a browser: provisional readings,
 * corner-shot helpers, the rules of automatic capture, the steadiness timer, merging of frames, and
 * the live finder following a drawn cube from frame to frame.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyMat3, quadToSquare } from '../src/vision/homography';
import {
  GATES,
  TWO_SHOT_VIEWS,
  UNSURE_BELOW,
  allCornerViews,
  classifyCube,
  classifyPartial,
  cornerFaceQuads,
  cornerFaces,
  detectFaceQuad,
  faceDistance,
  faceSampleFromRgb,
  findCorner,
  findFace,
  fuseSamples,
  hintText,
  sampleCornerShot,
  sampleFace,
  type CameraHintCode,
  type CornerOutline,
  type FaceSample,
  type ImageLike,
  type Point,
  type Quad,
} from '../src/vision/index';
import { guideCornerOutline, projectCornerView } from '../src/vision/detect';
import { LiveFinder, SteadyTimer, assessCorner, assessFace, faceShape, looksAlreadyCaptured, type LiveRequest } from '../src/vision/live';

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

const BASE: number[][] = [
  [253, 129, 35],
  [220, 223, 218],
  [66, 209, 82],
  [238, 220, 50],
  [202, 57, 56],
  [34, 112, 184],
];

function drawFaces(width: number, height: number, background: [number, number, number], faces: { quad: Quad; colours: number[][]; shade?: number }[]): ImageLike {
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
        else rgb = (face.colours[Math.floor(cv) * 6 + Math.floor(cu)] as number[]).map((c) => c * (face.shade ?? 1));
        break;
      }
      const o = (y * width + x) * 4;
      data[o] = rgb[0] as number;
      data[o + 1] = rgb[1] as number;
      data[o + 2] = rgb[2] as number;
      data[o + 3] = 255;
    }
  return { width, height, data };
}

const square = (cx: number, cy: number, side: number): Quad => [
  { x: cx - side / 2, y: cy - side / 2 },
  { x: cx + side / 2, y: cy - side / 2 },
  { x: cx + side / 2, y: cy + side / 2 },
  { x: cx - side / 2, y: cy + side / 2 },
];

interface Fixture {
  name: string;
  truth: string;
  rgb: number[];
  quality: number[];
}
const fixtures = (JSON.parse(readFileSync(new URL('./vision-fixtures.json', import.meta.url), 'utf8')) as { cubes: Fixture[] }).cubes;
const facesOf = (cube: Fixture): FaceSample[] => [0, 1, 2, 3, 4, 5].map((f) => faceSampleFromRgb(cube.rgb.slice(f * 108, f * 108 + 108), cube.quality.slice(f * 36, f * 36 + 36)));

describe('classifyPartial', () => {
  it('equals classifyCube when all six faces are given', () => {
    for (const cube of fixtures) {
      const faces = facesOf(cube);
      const whole = classifyCube(faces);
      const partial = classifyPartial(faces);
      expect(partial.complete).toBe(true);
      for (let f = 0; f < 6; f++) {
        expect(Array.from(partial.faces[f]!.groups)).toEqual(Array.from(whole.labels.slice(f * 36, f * 36 + 36)));
        expect(Array.from(partial.faces[f]!.confidence)).toEqual(Array.from(whole.confidence.slice(f * 36, f * 36 + 36)));
      }
      expect(partial.palette).toEqual(whole.palette);
      expect(partial.names).toEqual(whole.names);
    }
  });

  it('groups the stickers of the faces captured so far, and gets no worse as faces arrive', () => {
    const order = [2, 1, 5, 4, 0, 3];
    let wrongAtOne = 0;
    let wrongAtFive = 0;
    let stickersAtOne = 0;
    let stickersAtFive = 0;
    for (const cube of fixtures) {
      const faces = facesOf(cube);
      for (const n of [1, 5]) {
        const given: (FaceSample | null)[] = [null, null, null, null, null, null];
        for (let k = 0; k < n; k++) given[order[k] as number] = faces[order[k] as number] as FaceSample;
        const res = classifyPartial(given);
        expect(res.complete).toBe(false);
        expect(res.palette.length).toBe(6);
        expect(res.names.length).toBe(6);
        // Each group is charged with the stickers that are not of its most common true colour.
        const count = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
        for (let f = 0; f < 6; f++) {
          if (!given[f]) {
            expect(res.faces[f]).toBeNull();
            continue;
          }
          const face = res.faces[f]!;
          expect(face.groups.length).toBe(36);
          expect(face.confidence.length).toBe(36);
          for (let i = 0; i < 36; i++) {
            expect(face.groups[i]).toBeLessThan(6);
            expect(face.confidence[i]).toBeGreaterThanOrEqual(0);
            expect(face.confidence[i]).toBeLessThanOrEqual(1);
            (count[face.groups[i] as number] as number[])[Number(cube.truth[f * 36 + i])]!++;
          }
        }
        let wrong = 0;
        for (const row of count) wrong += row.reduce((a, b) => a + b, 0) - Math.max(...row);
        if (n === 1) {
          wrongAtOne += wrong;
          stickersAtOne += 36;
        } else {
          wrongAtFive += wrong;
          stickersAtFive += 180;
        }
      }
    }
    // The limits are loose on purpose: tools/synth/partial-eval.ts reports the real numbers.
    expect(wrongAtOne / stickersAtOne).toBeLessThan(0.05);
    expect(wrongAtFive / stickersAtFive).toBeLessThan(0.04);
  });

  it('handles no faces, and refuses a wrong number of slots', () => {
    const none = classifyPartial([null, null, null, null, null, null]);
    expect(none.faces.every((f) => f === null)).toBe(true);
    expect(none.palette.length).toBe(6);
    expect(() => classifyPartial([null])).toThrow();
    expect(UNSURE_BELOW).toBeGreaterThan(0);
    expect(UNSURE_BELOW).toBeLessThan(1);
  });

  it('gives the same groups whichever slot a single face is put in', () => {
    const face = facesOf(fixtures[0] as Fixture)[2] as FaceSample;
    const a = classifyPartial([null, null, face, null, null, null]);
    const b = classifyPartial([face, null, null, null, null, null]);
    expect(Array.from(a.faces[2]!.groups)).toEqual(Array.from(b.faces[0]!.groups));
  });
});

describe('corner shot helpers', () => {
  const rnd = rng(5);
  const shape = projectCornerView((38 * Math.PI) / 180, (4 * Math.PI) / 180, (-2 * Math.PI) / 180, 7);
  const outline = shape.map((p) => ({ x: 240 + p.x * 310, y: 320 + p.y * 310 })) as CornerOutline;
  const quads: Quad[] = [
    [outline[1], outline[2], outline[0], outline[6]],
    [outline[6], outline[0], outline[4], outline[5]],
    [outline[0], outline[2], outline[3], outline[4]],
  ];
  const colours = [0, 1, 2].map(() => Array.from({ length: 36 }, () => BASE[Math.floor(rnd() * 6)] as number[]));
  const img = drawFaces(
    480,
    640,
    [212, 212, 214],
    quads.map((quad, k) => ({ quad, colours: colours[k] as number[][], shade: [1, 0.72, 0.6][k] })),
  );

  it('cornerFaces gives the same sticker order with and without the camera samples, for every view', () => {
    const samples = sampleCornerShot(img, outline);
    for (const view of allCornerViews()) {
      const direct = cornerFaces(img, outline, view);
      const reindexed = cornerFaces(img, outline, view, samples);
      const quadsOnly = cornerFaceQuads(outline, view);
      expect(direct.map((f) => f.face).sort()).toEqual([view.top, view.left, view.right].sort());
      for (let k = 0; k < 3; k++) {
        expect(reindexed[k]!.face).toBe(direct[k]!.face);
        expect(reindexed[k]!.quad).toEqual(direct[k]!.quad);
        expect(quadsOnly[k]!.quad).toEqual(direct[k]!.quad);
        // The turned quad covers the same cells, so the two readings agree sticker by sticker.
        for (let i = 0; i < 108; i++) expect(Math.abs((reindexed[k]!.sample.rgb[i] as number) - (direct[k]!.sample.rgb[i] as number))).toBeLessThan(0.01);
        for (let i = 0; i < 36; i++) expect(Math.abs((reindexed[k]!.sample.quality[i] as number) - (direct[k]!.sample.quality[i] as number))).toBeLessThan(1e-4);
        // And sampling the turned quad is the same as sampleFace on it.
        const again = sampleFace(img, direct[k]!.quad);
        expect(Array.from(again.rgb)).toEqual(Array.from(direct[k]!.sample.rgb));
      }
    }
  });

  it('puts the first view of the two-shot flow on U, F and R in reading order', () => {
    const faces = cornerFaces(img, outline, TWO_SHOT_VIEWS[0]);
    expect(faces.map((f) => f.face)).toEqual([0, 2, 1]);
    // In the URF view the sampled faces already read like U, F and R.
    const samples = sampleCornerShot(img, outline);
    for (let k = 0; k < 3; k++) for (let i = 0; i < 108; i++) expect(Math.abs((faces[k]!.sample.rgb[i] as number) - (samples[k]!.rgb[i] as number))).toBeLessThan(0.01);
  });

  it('findCorner finds the drawn corner and reports the raw score', () => {
    const found = findCorner(img);
    expect(found.found).toBe(true);
    expect(found.score).toBeGreaterThan(0.4);
    for (let k = 0; k < 7; k++) expect(Math.hypot(found.outline[k]!.x - outline[k]!.x, found.outline[k]!.y - outline[k]!.y)).toBeLessThan(8);
  });
});

describe('rules of automatic capture', () => {
  const view = { x0: 0, y0: 0, x1: 300, y1: 400 };
  const guide = square(150, 200, 240);

  it('accepts a face that fills the guide straight on, and says what is wrong otherwise', () => {
    expect(assessFace(square(152, 198, 230), 1, guide, view)).toEqual({ ok: true, code: 'hold' });
    expect(assessFace(square(150, 200, 110), 1, guide, view).code).toBe('too-far');
    expect(assessFace(square(150, 200, 299), 1, guide, view).code).toBe('too-close');
    expect(assessFace(square(215, 200, 170), 1, guide, view).code).toBe('off-centre');
    expect(assessFace(square(150, 200, 230), 0.4, guide, view).code).toBe('unsure');
    const turned = square(0, 0, 220).map((p) => ({ x: 150 + p.x * Math.cos(0.6) - p.y * Math.sin(0.6), y: 200 + p.x * Math.sin(0.6) + p.y * Math.cos(0.6) })) as Quad;
    expect(assessFace(turned, 1, guide, view).code).toBe('rotated');
    // Without a guide the size is judged against the view.
    expect(assessFace(square(150, 200, 200), 1, null, view).ok).toBe(true);
    expect(assessFace(square(150, 200, 90), 1, null, view).code).toBe('too-far');
  });

  it('never accepts a side seen at a corner angle', () => {
    for (const el of [28, 34, 40, 46])
      for (const sw of [-11, 0, 11]) {
        const o = projectCornerView((el * Math.PI) / 180, (sw * Math.PI) / 180, 0, 7).map((p) => ({ x: 150 + p.x * 240, y: 200 + p.y * 240 }));
        const faces: Quad[] = [
          [o[1] as Point, o[2] as Point, o[0] as Point, o[6] as Point],
          [o[6] as Point, o[0] as Point, o[4] as Point, o[5] as Point],
          [o[0] as Point, o[2] as Point, o[3] as Point, o[4] as Point],
        ];
        for (const q of faces) {
          const verdict = assessFace(q, 1, null, view);
          expect(verdict.ok).toBe(false);
          expect(['other-sides', 'tilted']).toContain(verdict.code);
        }
      }
  });

  it('accepts a face tilted a little and refuses a strong tilt', () => {
    const tilt = (taper: number): Quad => [
      { x: 150 - 110 / taper, y: 90 },
      { x: 150 + 110 / taper, y: 90 },
      { x: 150 + 110, y: 310 },
      { x: 150 - 110, y: 310 },
    ];
    expect(assessFace(tilt(1.08), 1, guide, view).ok).toBe(true);
    expect(assessFace(tilt(1.5), 1, guide, view).ok).toBe(false);
    expect(faceShape(tilt(1.5)).taper).toBeCloseTo(1.5, 5);
  });

  it('accepts a corner view that shows three sides, and says what is wrong otherwise', () => {
    const g = guideCornerOutline(150, 200, 240);
    expect(assessCorner(guideCornerOutline(155, 195, 230), 1, g, view)).toEqual({ ok: true, code: 'hold' });
    expect(assessCorner(guideCornerOutline(150, 200, 100), 1, g, view).code).toBe('too-far');
    expect(assessCorner(guideCornerOutline(150, 200, 330), 1, g, view).code).toBe('too-close');
    expect(assessCorner(guideCornerOutline(150, 200, 230), 0.3, g, view).code).toBe('unsure');
    // Seen from almost straight above, the two lower sides are slivers.
    const flat = projectCornerView((80 * Math.PI) / 180, 0, 0, 7).map((p) => ({ x: 150 + p.x * 230, y: 200 + p.y * 230 }));
    expect(assessCorner(flat, 1, g, view).code).toBe('one-side');
  });

  it('has words for every hint', () => {
    const codes: CameraHintCode[] = ['starting', 'no-camera', 'not-found', 'too-far', 'too-close', 'off-centre', 'tilted', 'rotated', 'other-sides', 'one-side', 'same-side', 'unsure', 'moving', 'hold', 'captured'];
    for (const code of codes) for (const mode of ['face', 'corner'] as const) expect(hintText(code, mode).length).toBeGreaterThan(3);
  });
});

describe('steadiness and merging of frames', () => {
  it('counts up while the outline stays put and starts again when it moves', () => {
    const timer = new SteadyTimer(600);
    const pts = [0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8];
    const jitter = (d: number): number[] => pts.map((v) => v + d);
    expect(timer.add(0, pts, 0.6)).toEqual({ progress: 0, moved: false });
    expect(timer.add(200, jitter(0.004), 0.6).progress).toBeCloseTo(1 / 3, 5);
    expect(timer.add(400, jitter(-0.004), 0.6).progress).toBeCloseTo(2 / 3, 5);
    expect(timer.add(650, jitter(0.002), 0.6).progress).toBe(1);
    const moved = timer.add(700, jitter(GATES.drift * 0.6 + 0.01), 0.6);
    expect(moved).toEqual({ progress: 0, moved: true });
    expect(timer.add(1400, jitter(GATES.drift * 0.6 + 0.01), 0.6).progress).toBeLessThan(1); // only two looks so far
    expect(timer.add(1450, jitter(GATES.drift * 0.6 + 0.01), 0.6).progress).toBe(1);
  });

  it('merges frames sticker by sticker, leaving out the frames where a sticker was spoiled', () => {
    const clean = { rgb: new Float32Array(108).fill(100), quality: new Float32Array(36).fill(0.9) };
    const noisy = { rgb: new Float32Array(108).fill(104), quality: new Float32Array(36).fill(0.88) };
    const glared = { rgb: new Float32Array(108).fill(100), quality: new Float32Array(36).fill(0.9) };
    for (let c = 0; c < 3; c++) glared.rgb[5 * 3 + c] = 250;
    glared.quality[5] = 0.2;
    const fused = fuseSamples([clean, noisy, glared]);
    expect(fused.rgb[0]).toBeGreaterThan(100);
    expect(fused.rgb[0]).toBeLessThan(104);
    expect(fused.rgb[5 * 3]).toBeLessThan(105); // the glared frame is left out for sticker 5
    expect(fused.quality[5]).toBeCloseTo(0.9, 5);
    expect(fused.lab.length).toBe(108);
    expect(Array.from(fuseSamples([clean]).rgb)).toEqual(Array.from(clean.rgb));
  });

  it('recognises a face it has seen before, also turned, and tells different faces apart', () => {
    const faces = facesOf(fixtures[0] as Fixture);
    const a = faces[0] as FaceSample;
    const turned = faceSampleFromRgb(Array.from({ length: 36 }, (_, i) => {
      const r = Math.floor(i / 6);
      const c = i % 6;
      const j = c * 6 + (5 - r);
      return [a.rgb[j * 3] as number, a.rgb[j * 3 + 1] as number, a.rgb[j * 3 + 2] as number];
    }).flat());
    const dimmer = faceSampleFromRgb(Array.from(a.rgb, (v) => v * 0.9));
    expect(faceDistance(a, turned)).toBeLessThan(1);
    expect(looksAlreadyCaptured([dimmer], [a])).toBe(true);
    for (let f = 1; f < 6; f++) expect(looksAlreadyCaptured([faces[f] as FaceSample], [a])).toBe(false);
  });
});

describe('live finder', () => {
  const rnd = rng(8);
  const colours = Array.from({ length: 36 }, () => BASE[Math.floor(rnd() * 6)] as number[]);
  const frame = (cx: number, cy: number, side: number): ImageLike => drawFaces(240, 320, [205, 205, 210], [{ quad: square(cx, cy, side), colours }]);
  const request = (id: number, image: ImageLike, extra: Partial<LiveRequest> = {}): LiveRequest => ({ id, kind: 'frame', mode: 'face', width: image.width, height: image.height, data: image.data as Uint8ClampedArray, near: square(120, 160, 190).flatMap((p) => [p.x, p.y]), samples: false, verify: false, reset: false, ...extra });
  const worst = (points: number[], quad: Quad): number => {
    let e = 0;
    for (let k = 0; k < 4; k++) e = Math.max(e, Math.hypot((points[k * 2] as number) - quad[k]!.x, (points[k * 2 + 1] as number) - quad[k]!.y));
    return e;
  };

  it('finds a face in a small frame, follows it as it moves, and reads its stickers when asked', () => {
    const finder = new LiveFinder();
    const first = finder.handle(request(1, frame(118, 158, 170)));
    expect(first.found).toBe(true);
    expect(first.tracked).toBe(false);
    expect(first.confidence).toBeGreaterThan(0.75);
    expect(worst(first.points, square(118, 158, 170))).toBeLessThan(170 / 6 / 4);
    const second = finder.handle(request(2, frame(121, 160, 172)));
    expect(second.found).toBe(true);
    expect(second.tracked).toBe(true);
    expect(worst(second.points, square(121, 160, 172))).toBeLessThan(170 / 6 / 4);
    const third = finder.handle(request(3, frame(122, 161, 172), { samples: true, verify: true }));
    expect(third.samples?.length).toBe(1);
    for (let i = 0; i < 36; i++) for (let c = 0; c < 3; c++) expect(Math.abs((third.samples![0]!.rgb[i * 3 + c] as number) - ((colours[i] as number[])[c] as number))).toBeLessThan(8);
    expect(third.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it('reports nothing on an empty frame and recovers when the cube comes back', () => {
    const finder = new LiveFinder();
    expect(finder.handle(request(1, frame(120, 160, 170))).found).toBe(true);
    const empty = finder.handle(request(2, drawFaces(240, 320, [205, 205, 210], [])));
    expect(empty.confidence).toBeLessThan(GATES.show);
    const back = finder.handle(request(3, frame(126, 150, 160)));
    expect(back.found).toBe(true);
    expect(worst(back.points, square(126, 150, 160))).toBeLessThan(160 / 6 / 4);
  });

  it('findFace agrees with detectFaceQuad and adds the score', () => {
    const img = frame(120, 160, 170);
    const a = findFace(img);
    const b = detectFaceQuad(img);
    expect(a.quad).toEqual(b.quad);
    expect(a.confidence).toBe(b.confidence);
    expect(a.found).toBe(true);
    expect(a.score).toBeGreaterThan(0.3);
  });
});
