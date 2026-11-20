/**
 * Live finding for the camera: follows the cube outline from one video frame to the next, decides
 * whether a frame is good enough to take by itself, and merges the sticker samples of several frames.
 * Pure functions and one small state machine, so the same code runs in a Web Worker, on the main
 * thread (fallback and tests) and in Node.
 */
import { rgbToLab } from './color';
import { cornerQuads } from './corner';
import { confidenceOf, findCorner, findFace, predictFarCorner, shiftTestFace, verifyCorner, type NearHint } from './detect';
import { buildEdgeMap, refinePoints, CORNER_OUTSIDE, OUTSIDE_ALL } from './refine';
import { sampleFace } from './sample';
import type { CornerOutline, FaceSample, ImageLike, Point, Quad } from './types';

export type CaptureMode = 'face' | 'corner';

export type CameraHintCode =
  | 'starting'
  | 'no-camera'
  | 'not-found'
  | 'too-far'
  | 'too-close'
  | 'off-centre'
  | 'tilted'
  | 'rotated'
  | 'other-sides'
  | 'one-side'
  | 'same-side'
  | 'unsure'
  | 'moving'
  | 'hold'
  | 'captured';

/** Default words for each hint. The app may use its own, keyed by the code. */
export function hintText(code: CameraHintCode, mode: CaptureMode): string {
  switch (code) {
    case 'starting':
      return 'Starting the camera';
    case 'no-camera':
      return 'The camera is not available';
    case 'not-found':
      return mode === 'face' ? 'Point the camera at one side of the cube' : 'Point the camera at a corner of the cube';
    case 'too-far':
      return 'Move closer';
    case 'too-close':
      return 'Move back a little';
    case 'off-centre':
      return 'Centre the cube in the frame';
    case 'tilted':
    case 'other-sides':
      return 'Tilt until you see only this side';
    case 'rotated':
      return 'Straighten the cube';
    case 'one-side':
      return 'Turn the cube until you see three sides about equally';
    case 'same-side':
      return mode === 'face' ? 'This side is already scanned. Turn the cube to the next side' : 'These sides are already scanned. Turn the cube over';
    case 'unsure':
      return 'Hold the cube where all its stickers can be seen';
    case 'moving':
    case 'hold':
      return 'Hold still';
    case 'captured':
      return 'Got it';
  }
}

// ---------------------------------------------------------------------------------------------
// Messages between the camera and the finder (the worker protocol).

export interface LiveRequest {
  id: number;
  /** frame: one frame of the live video. still: a photo to search thoroughly (shutter, file). */
  kind: 'frame' | 'still';
  mode: CaptureMode;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** The on-screen guide in pixels of this image (x, y pairs), or null. */
  near: number[] | null;
  /** Also read the stickers (asked for on full-size frames). */
  samples: boolean;
  /** Test a followed outline against the same outline one sticker over. */
  verify: boolean;
  /** Forget the outline of earlier frames. */
  reset: boolean;
  /**
   * Asked for on the last frame before an automatic capture: search this frame afresh as well and
   * say whether that search arrives at the outline that was followed (LiveResponse.confirmed).
   */
  confirm?: boolean;
}

export interface RawSample {
  rgb: Float32Array;
  quality: Float32Array;
}

export interface LiveResponse {
  id: number;
  found: boolean;
  /** Outline in pixels of the image (x, y pairs): 4 points for a face, 7 for a corner. */
  points: number[];
  score: number;
  confidence: number;
  /** True when the outline was followed from the previous frame, false when it was searched for afresh. */
  tracked: boolean;
  /** Only when the request asked for it: a fresh search of this frame gave the same outline as following did. */
  confirmed?: boolean;
  samples: RawSample[] | null;
  /** Time spent, for measuring. */
  ms: number;
  width: number;
  height: number;
  /** The pixels, handed back so the camera can keep the frame. */
  data: Uint8ClampedArray;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function nearOf(mode: CaptureMode, near: number[] | null): NearHint | null {
  if (!near || near.length < 8) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < near.length; i += 2) {
    x0 = Math.min(x0, near[i] as number);
    x1 = Math.max(x1, near[i] as number);
    y0 = Math.min(y0, near[i + 1] as number);
    y1 = Math.max(y1, near[i + 1] as number);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: mode === 'face' ? Math.max(x1 - x0, y1 - y0) : x1 - x0 };
}

const toPoints = (flat: readonly number[]): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i] as number, y: flat[i + 1] as number });
  return out;
};
const toFlat = (pts: readonly Point[]): number[] => pts.flatMap((p) => [p.x, p.y]);

/** A followed outline is dropped when its score falls below this, and a fresh search is made. */
const TRACK_MIN_SCORE = 0.2;
/** A fresh search is also made every so many followed frames, in case the outline locked onto the wrong thing. */
const RESEARCH_EVERY = 10;
/**
 * Confirmation before an automatic capture: how far any point of a fresh search may be from the
 * followed outline, in sticker sides. Measured (docs/vision-report.md, Version 2): a followed outline
 * lags behind a cube that is still coming closer and can be a whole sticker off while its score still
 * looks good; a fresh search of the same frame does not have that memory.
 */
export const CONFIRM_WITHIN = 0.3;

/** Largest distance between matching points of two outlines, in sticker sides of the first. */
export function outlineDistance(a: readonly Point[], b: readonly Point[]): number {
  if (a.length !== b.length || a.length < 4) return Infinity;
  const p0 = a[0] as Point;
  const p1 = a[1] as Point;
  // Both for a face quad and for a corner outline, points 0 and 1 are the ends of one cube edge.
  const sticker = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 6;
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.hypot((a[i] as Point).x - (b[i] as Point).x, (a[i] as Point).y - (b[i] as Point).y));
  return worst / Math.max(1e-9, sticker);
}

/**
 * Follows the outline through the frames it is given. One instance per camera; frames may differ in
 * size (small frames while searching, full-size frames while the cube is held steady).
 */
export class LiveFinder {
  private previous: number[] | null = null;
  private previousScore = 0;
  private mode: CaptureMode = 'face';
  private followed = 0;

  reset(): void {
    this.previous = null;
    this.previousScore = 0;
    this.followed = 0;
  }

  handle(req: LiveRequest): LiveResponse {
    const t0 = now();
    const image: ImageLike = { width: req.width, height: req.height, data: req.data };
    if (req.reset || req.mode !== this.mode) this.reset();
    this.mode = req.mode;
    const near = nearOf(req.mode, req.near);
    const short = Math.min(req.width, req.height);
    const long = Math.max(req.width, req.height);
    const quadsOf = req.mode === 'face' ? (p: Point[]): Quad[] => [[p[0] as Point, p[1] as Point, p[2] as Point, p[3] as Point]] : (p: Point[]): Quad[] => cornerQuads(p as CornerOutline);
    const outside = req.mode === 'face' ? [OUTSIDE_ALL] : CORNER_OUTSIDE;
    let best: { points: Point[]; score: number } | null = null;
    let tracked = false;
    let confirmed: boolean | undefined = req.confirm ? false : undefined;
    try {
      if (this.previous) {
        const fineSide = Math.min(1400, Math.round(((req.mode === 'face' ? 440 : 460) * long) / Math.max(1, short)));
        const fine = buildEdgeMap(image, fineSide, [4, 2, 1, 0]);
        const start = toPoints(this.previous).map((p) => ({ x: p.x * req.width, y: p.y * req.height }));
        const xs = start.map((p) => p.x);
        const width = Math.max(...xs) - Math.min(...xs);
        const r = refinePoints(fine, start, quadsOf, Math.max(1.5, width / (req.mode === 'face' ? 16 : 34)), outside, 0, 20);
        if (r.score >= Math.max(TRACK_MIN_SCORE, 0.5 * this.previousScore)) {
          best = { points: r.points, score: r.score };
          tracked = true;
          if (req.verify) {
            if (req.mode === 'face') {
              const v = shiftTestFace(fine, { quad: best.points as Quad, score: best.score }, 1);
              best = { points: v.quad, score: v.score };
            } else {
              const v = verifyCorner(fine, { outline: best.points as CornerOutline, score: best.score }, short, 1);
              best = { points: v.outline, score: v.score };
            }
          }
        }
      }
      const research = req.kind === 'still' || !best || !!req.confirm || (!req.samples && this.followed >= RESEARCH_EVERY);
      if (research) {
        // A confirmation is the thorough search: the quick one shares the mistakes of the outline it started.
        const quick = req.kind !== 'still' && !req.confirm;
        const f = req.mode === 'face' ? findFace(image, { near, quick }) : findCorner(image, { near, quick });
        const pts = req.mode === 'face' ? (f as { quad: Quad }).quad : (f as { outline: CornerOutline }).outline;
        this.followed = 0;
        // Agreement keeps the followed outline (it was fitted on the finer edge map). After a
        // disagreement the thorough search is believed; otherwise the better score wins, as always.
        if (req.confirm && best && f.found && outlineDistance(best.points, pts) <= CONFIRM_WITHIN) confirmed = true;
        else if (f.found && (!best || req.confirm || f.score > best.score + 0.02)) {
          best = { points: pts.map((p) => ({ x: p.x, y: p.y })), score: f.score };
          tracked = false;
        }
      } else this.followed++;
    } catch {
      best = null;
    }
    const res: LiveResponse = { id: req.id, found: false, points: [], score: 0, confidence: 0, tracked, samples: null, ms: 0, width: req.width, height: req.height, data: req.data };
    if (confirmed !== undefined) res.confirmed = confirmed && !!best;
    if (best && Number.isFinite(best.score) && best.score > 0) {
      res.found = true;
      res.points = toFlat(best.points);
      res.score = best.score;
      res.confidence = confidenceOf(best.score);
      this.previous = best.points.flatMap((p) => [p.x / req.width, p.y / req.height]);
      this.previousScore = best.score;
      if (req.samples) {
        const quads = quadsOf(best.points);
        res.samples = quads.map((q) => {
          const s = sampleFace(image, q);
          return { rgb: s.rgb, quality: s.quality };
        });
      }
    } else {
      this.reset();
    }
    res.ms = now() - t0;
    return res;
  }
}

// ---------------------------------------------------------------------------------------------
// Is this outline good enough to take the photo?

/** What the user can see of the frame (object-fit: cover crops the rest), in frame pixels. */
export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The thresholds of automatic capture. Chosen from the measurements in docs/vision-report.md (Version 2). */
export const GATES = {
  /** Lowest outline confidence that may be captured. */
  confidence: 0.75,
  /** Lowest outline confidence that is drawn at all. */
  show: 0.25,
  face: {
    /** Longer over shorter of two opposite sides: perspective from tilting. */
    taper: 1.2,
    /** Width over height or the reverse. */
    aspect: 1.16,
    /** Largest corner angle away from 90 degrees. */
    skewDeg: 11,
    /** Largest turn of the face in the picture. */
    rollDeg: 25,
    /** Side of the face relative to the side of the guide. */
    minSize: 0.5,
    maxSize: 1.22,
    /** Distance of the centres in guide sides. */
    offCentre: 0.2,
    /** Without a guide: side of the face relative to the shorter side of the view. */
    minOfView: 0.4,
  },
  corner: {
    /** Width of the silhouette relative to the shorter side of the view. */
    minOfView: 0.42,
    /** Smallest share of the outline area any of the three faces may have. */
    minFaceShare: 0.16,
    /** Largest turn of the vertical cube edge away from upright. */
    rollDeg: 22,
    /** Distance of the centres in guide widths. */
    offCentre: 0.25,
    /**
     * How far a far corner may be from where the other six points say a cube corner must be, in
     * silhouette widths. A real corner view is a projection of a cube; seven points fitted to one flat
     * side are not. Measured on set v3: right corner outlines from the live finder reach 0.063 at most
     * (121 outlines, median 0.016); the nearest straight-on photo that passes the other rules is at 0.129.
     */
    cubeness: 0.1,
  },
  /** Steadiness: how far any outline point may be from where it was when the countdown began, in face sides (or silhouette widths times 0.6). */
  drift: 0.07,
  /** Mean colour distance below which a face counts as one that was already captured. */
  sameSide: 16,
};

export interface FaceShape {
  side: number;
  aspect: number;
  taper: number;
  skewDeg: number;
  rollDeg: number;
  cx: number;
  cy: number;
}

export function faceShape(q: readonly Point[]): FaceShape {
  const d = (i: number, j: number): number => Math.hypot((q[i] as Point).x - (q[j] as Point).x, (q[i] as Point).y - (q[j] as Point).y);
  const a = d(0, 1);
  const b = d(1, 2);
  const c = d(2, 3);
  const e = d(3, 0);
  let skew = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i] as Point;
    const n = q[(i + 1) % 4] as Point;
    const m = q[(i + 3) % 4] as Point;
    const cos = ((n.x - p.x) * (m.x - p.x) + (n.y - p.y) * (m.y - p.y)) / Math.max(1e-9, Math.hypot(n.x - p.x, n.y - p.y) * Math.hypot(m.x - p.x, m.y - p.y));
    skew = Math.max(skew, Math.abs(90 - (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI));
  }
  const q0 = q[0] as Point;
  const q1 = q[1] as Point;
  const q2 = q[2] as Point;
  const q3 = q[3] as Point;
  return {
    side: (a + b + c + e) / 4,
    aspect: Math.max((a + c) / Math.max(1e-9, b + e), (b + e) / Math.max(1e-9, a + c)),
    taper: Math.max(a / Math.max(1e-9, c), c / Math.max(1e-9, a), b / Math.max(1e-9, e), e / Math.max(1e-9, b)),
    skewDeg: skew,
    rollDeg: (Math.atan2(q1.y - q0.y + q2.y - q3.y, q1.x - q0.x + q2.x - q3.x) * 180) / Math.PI,
    cx: (q0.x + q1.x + q2.x + q3.x) / 4,
    cy: (q0.y + q1.y + q2.y + q3.y) / 4,
  };
}

function bounds(pts: readonly Point[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

function polygonArea(pts: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Point;
    const q = pts[(i + 1) % pts.length] as Point;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

export interface Assessment {
  ok: boolean;
  code: CameraHintCode;
}

/** May this face outline be captured? If not, the code says what the user should change. */
export function assessFace(quad: readonly Point[], confidence: number, guide: readonly Point[] | null, view: ViewRect): Assessment {
  const s = faceShape(quad);
  const g = GATES.face;
  const b = bounds(quad);
  const viewShort = Math.min(view.x1 - view.x0, view.y1 - view.y0);
  const margin = 0.01 * viewShort;
  const cut = b.x0 < view.x0 - margin || b.y0 < view.y0 - margin || b.x1 > view.x1 + margin || b.y1 > view.y1 + margin;
  // Shape first: a side seen at a corner angle must never pass, whatever its size.
  if (s.skewDeg > 2 * g.skewDeg || s.aspect > 1.35 || s.taper > 1.5) return { ok: false, code: 'other-sides' };
  if (s.skewDeg > g.skewDeg || s.aspect > g.aspect || s.taper > g.taper) return { ok: false, code: 'tilted' };
  if (Math.abs(s.rollDeg) > g.rollDeg) return { ok: false, code: 'rotated' };
  if (guide && guide.length === 4) {
    const gs = faceShape(guide);
    if (s.side > g.maxSize * gs.side || cut) return { ok: false, code: 'too-close' };
    if (s.side < g.minSize * gs.side) return { ok: false, code: 'too-far' };
    if (Math.hypot(s.cx - gs.cx, s.cy - gs.cy) > g.offCentre * gs.side) return { ok: false, code: 'off-centre' };
  } else {
    if (cut) return { ok: false, code: 'too-close' };
    if (s.side < g.minOfView * viewShort) return { ok: false, code: 'too-far' };
  }
  if (confidence < GATES.confidence) return { ok: false, code: 'unsure' };
  return { ok: true, code: 'hold' };
}

/** May this corner outline be captured? */
export function assessCorner(outline: readonly Point[], confidence: number, guide: readonly Point[] | null, view: ViewRect): Assessment {
  const g = GATES.corner;
  const b = bounds(outline);
  const viewShort = Math.min(view.x1 - view.x0, view.y1 - view.y0);
  const margin = 0.01 * viewShort;
  const quads = cornerQuads(outline as CornerOutline);
  const areas = quads.map((q) => polygonArea(q));
  const total = (areas[0] as number) + (areas[1] as number) + (areas[2] as number);
  if (Math.min(...areas) < g.minFaceShare * total) return { ok: false, code: 'one-side' };
  for (const which of [1, 3, 5] as const) {
    const p = predictFarCorner(outline, which);
    if (!p || Math.hypot(p.x - (outline[which] as Point).x, p.y - (outline[which] as Point).y) > g.cubeness * (b.x1 - b.x0)) return { ok: false, code: 'one-side' };
  }
  const o0 = outline[0] as Point;
  const o4 = outline[4] as Point;
  const roll = (Math.atan2(o4.x - o0.x, o4.y - o0.y) * 180) / Math.PI;
  if (Math.abs(roll) > g.rollDeg) return { ok: false, code: 'rotated' };
  if (b.x0 < view.x0 - margin || b.y0 < view.y0 - margin || b.x1 > view.x1 + margin || b.y1 > view.y1 + margin) return { ok: false, code: 'too-close' };
  if (b.x1 - b.x0 < g.minOfView * viewShort) return { ok: false, code: 'too-far' };
  if (guide && guide.length === 7) {
    const gb = bounds(guide);
    const gw = gb.x1 - gb.x0;
    if (Math.hypot((b.x0 + b.x1 - gb.x0 - gb.x1) / 2, (b.y0 + b.y1 - gb.y0 - gb.y1) / 2) > g.offCentre * gw) return { ok: false, code: 'off-centre' };
  }
  if (confidence < GATES.confidence) return { ok: false, code: 'unsure' };
  return { ok: true, code: 'hold' };
}

/** Counts how long the outline has stayed where it was. */
export class SteadyTimer {
  private anchor: number[] | null = null;
  private since = 0;
  private count = 0;

  constructor(private readonly steadyMs: number) {}

  reset(): void {
    this.anchor = null;
    this.count = 0;
  }

  /** points: the outline (x, y pairs, any consistent unit); size: its width in the same unit. Returns the progress 0..1 and whether the outline moved away. */
  add(time: number, points: readonly number[], size: number): { progress: number; moved: boolean } {
    const limit = GATES.drift * size * (points.length > 8 ? 0.6 : 1);
    let moved = false;
    if (this.anchor && this.anchor.length === points.length) {
      for (let i = 0; i < points.length; i += 2) if (Math.hypot((points[i] as number) - (this.anchor[i] as number), (points[i + 1] as number) - (this.anchor[i + 1] as number)) > limit) moved = true;
    }
    if (!this.anchor || this.anchor.length !== points.length || moved) {
      moved = moved || false;
      this.anchor = Array.from(points);
      this.since = time;
      this.count = 1;
      return { progress: 0, moved };
    }
    this.count++;
    const p = Math.min(1, (time - this.since) / this.steadyMs);
    return { progress: this.count >= 3 ? p : Math.min(p, 0.95), moved: false };
  }
}

/** A complete FaceSample from the colours and qualities the finder returns. */
export function toFaceSample(raw: RawSample): FaceSample {
  const lab = new Float32Array(108);
  for (let i = 0; i < 36; i++) {
    const l = rgbToLab(raw.rgb[i * 3] as number, raw.rgb[i * 3 + 1] as number, raw.rgb[i * 3 + 2] as number);
    lab[i * 3] = l[0];
    lab[i * 3 + 1] = l[1];
    lab[i * 3 + 2] = l[2];
  }
  return { rgb: Float32Array.from(raw.rgb), lab, quality: Float32Array.from(raw.quality) };
}

/**
 * One sample per sticker from several frames of the same face. A reflection moves when the hand
 * shakes, so for each sticker the frames whose sample is nearly as clean as the cleanest are averaged
 * and the others (caught in the glare, or blurred) are left out.
 */
export function fuseSamples(frames: readonly RawSample[]): FaceSample {
  if (frames.length === 1) return toFaceSample(frames[0] as RawSample);
  const rgb = new Float32Array(108);
  const quality = new Float32Array(36);
  for (let i = 0; i < 36; i++) {
    let top = 0;
    for (const f of frames) top = Math.max(top, f.quality[i] as number);
    let r = 0;
    let g = 0;
    let b = 0;
    let w = 0;
    for (const f of frames) {
      const q = f.quality[i] as number;
      if (q < 0.85 * top - 1e-6) continue;
      const weight = Math.max(1e-3, q);
      r += weight * (f.rgb[i * 3] as number);
      g += weight * (f.rgb[i * 3 + 1] as number);
      b += weight * (f.rgb[i * 3 + 2] as number);
      w += weight;
    }
    rgb[i * 3] = r / w;
    rgb[i * 3 + 1] = g / w;
    rgb[i * 3 + 2] = b / w;
    quality[i] = top;
  }
  return toFaceSample({ rgb, quality });
}

const TURNS: number[][] = [0, 1, 2, 3].map((turn) => {
  const map: number[] = [];
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 6; c++) {
      let rr = r;
      let cc = c;
      for (let k = 0; k < turn; k++) [rr, cc] = [cc, 5 - rr];
      map.push(rr * 6 + cc);
    }
  return map;
});

/** Mean colour distance between two faces, taking the best of the four ways one can be turned against the other. Brightness counts half. */
export function faceDistance(a: FaceSample, b: FaceSample): number {
  let best = Infinity;
  for (const map of TURNS) {
    let s = 0;
    for (let i = 0; i < 36; i++) {
      const j = map[i] as number;
      s += Math.hypot(0.5 * ((a.lab[i * 3] as number) - (b.lab[j * 3] as number)), (a.lab[i * 3 + 1] as number) - (b.lab[j * 3 + 1] as number), (a.lab[i * 3 + 2] as number) - (b.lab[j * 3 + 2] as number));
    }
    best = Math.min(best, s / 36);
  }
  return best;
}

/** True when any of the faces looks like one of the faces to avoid. */
export function looksAlreadyCaptured(faces: readonly FaceSample[], avoid: readonly FaceSample[]): boolean {
  for (const f of faces) for (const a of avoid) if (faceDistance(f, a) < GATES.sameSide) return true;
  return false;
}
