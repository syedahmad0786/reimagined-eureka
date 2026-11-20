/**
 * Live camera. Version 1 behaviour (no new options): a square 6x6 guide, the user fills it with one
 * face and taps the shutter. With live or auto on, the camera finds the cube in the video, draws its
 * outline, tells the app what to say through onStatus, and with auto takes the photo by itself once
 * the outline is aligned and has stayed put. The shutter and the file input stay as fallbacks.
 * Uses the rear camera through getUserMedia (needs HTTPS or localhost).
 */
import { cornerQuads } from './corner';
import { confidenceOf, findCorner, findFace, guideCornerOutline } from './detect';
import { centredSquareQuad } from './homography';
import {
  GATES,
  LiveFinder,
  SteadyTimer,
  assessCorner,
  assessFace,
  fuseSamples,
  hintText,
  looksAlreadyCaptured,
  toFaceSample,
  type CameraHintCode,
  type CaptureMode,
  type LiveRequest,
  type LiveResponse,
  type RawSample,
} from './live';
import { loadImageFile, toImageData, WORKING_SIZE } from './load';
import type { CornerOutline, FaceSample, Point, Quad } from './types';

export type { CameraHintCode, CaptureMode } from './live';

export type CameraState = 'starting' | 'searching' | 'adjust' | 'steady' | 'captured' | 'no-camera';

export interface CameraStatus {
  state: CameraState;
  /** Stable id of the hint, for apps that want their own words. */
  code: CameraHintCode;
  /** Default plain-English hint. */
  hint: string;
  /** 0..1 of the steady countdown (0 outside 'steady', 1 at 'captured'). */
  progress: number;
  /** The outline found: 4 points (face) or 7 (corner), as fractions 0..1 of the camera view box as displayed. */
  outline: Point[] | null;
  /** 0..1 of the live outline. */
  confidence: number;
}

export interface CameraCaptureOptions {
  onError?: (message: string) => void;
  /** Share of the shorter side of the view that the guide covers (default 0.8). */
  guideFraction?: number;
  /** Show the guide (default true): a square 6x6 grid for a face, a corner-view shape for a corner shot. */
  guide?: boolean;
  /** What is being photographed (default 'face'). */
  mode?: CaptureMode;
  /** Take the photo automatically when the outline is aligned and steady (default false). */
  auto?: boolean;
  /** Find the cube live and draw its outline (default: the value of auto). */
  live?: boolean;
  /** Told when the state, the hint or the outline changes, at most about ten times a second. */
  onStatus?: (status: CameraStatus) => void;
  /** Faces already captured: automatic capture does not fire on a side that looks like one of them. */
  avoid?: readonly FaceSample[];
  /** How long the outline must stay put before the photo is taken, in milliseconds (default 600). */
  steadyMs?: number;
  /** Run the finder in a Web Worker (default true). false runs it on the main thread. */
  worker?: boolean;
}

export interface CapturedFrame {
  image: ImageData;
  /** The face outline. For a corner shot: the quad of the top face. */
  quad: Quad;
  mode: CaptureMode;
  /** Corner shots: the seven outline points. */
  outline?: CornerOutline;
  /** 0..1 of the outline. Below OUTLINE_SURE the user should be shown the grips. */
  confidence: number;
  /** True when the camera took the photo by itself. */
  auto: boolean;
  source: 'auto' | 'shutter' | 'file';
  /**
   * The sticker samples read by the camera: one face, or three for a corner shot (top, left, right),
   * merged over the frames of the steady moment. Present when live finding is on and the cube was found.
   */
  samples?: FaceSample[];
}

/** Outline confidence from which the outline can be trusted without showing the grips. */
export const OUTLINE_SURE = 0.9;

/** Long side of the frames the live finder works on. */
const LIVE_SIDE = 320;
/** Shortest time between two live frames, in milliseconds. */
const FRAME_GAP = 70;
/** Frames kept from the steady moment. */
const BURST = 5;

const STYLE_ID = 'vz-camera-style';
const CSS = [
  '.vz-camera { position: relative; width: 100%; aspect-ratio: 3 / 4; max-height: 76vh; background: #000; border-radius: var(--radius, 14px); overflow: hidden; font-family: var(--font, system-ui, sans-serif); color: var(--text, #eef1f5); }',
  '.vz-camera.vz-fill { height: 100%; max-height: none; }',
  '.vz-camera video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }',
  '.vz-camera .vz-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }',
  '.vz-camera .vz-guide { position: absolute; pointer-events: none; box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.42); border: 3px solid var(--highlight, #7df9ff); border-radius: 6px; background-image: linear-gradient(to right, rgba(255,255,255,0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.55) 1px, transparent 1px); background-size: calc(100% / 6) calc(100% / 6); }',
  '.vz-camera.vz-live .vz-guide { border: 2px solid rgba(255, 255, 255, 0.6); background-image: none; box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.3); }',
  '.vz-camera .vz-bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; gap: var(--gap, 12px); padding: 12px; }',
  '.vz-camera .vz-shutter { position: relative; width: 76px; height: 76px; border-radius: 50%; border: 5px solid #fff; background: var(--accent, #5aa2ff); cursor: pointer; padding: 0; touch-action: manipulation; }',
  '.vz-camera .vz-shutter::after { content: ""; position: absolute; inset: -12px; border-radius: 50%; pointer-events: none; background: conic-gradient(var(--highlight, #7df9ff) calc(var(--vz-progress, 0) * 360deg), transparent 0); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px)); mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px)); }',
  '.vz-camera .vz-shutter:active { transform: scale(0.94); }',
  '@media (prefers-reduced-motion: reduce) { .vz-camera .vz-shutter:active { transform: none; } }',
  '.vz-camera .vz-shutter:disabled { opacity: 0.4; }',
  '.vz-camera .vz-shutter:focus-visible, .vz-camera .vz-file:focus-within { outline: 3px solid var(--highlight, #7df9ff); outline-offset: 3px; }',
  '.vz-camera .vz-file { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: var(--tap, 52px); min-width: var(--tap, 52px); padding: 0 16px; border-radius: var(--radius-sm, 9px); background: var(--surface-2, #1e232c); border: 1px solid var(--border, #2c3440); font-size: 15px; cursor: pointer; }',
  '.vz-camera .vz-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }',
  '.vz-camera .vz-note { position: absolute; left: 12px; right: 12px; top: 12px; padding: 10px 12px; border-radius: var(--radius-sm, 9px); background: rgba(13, 16, 21, 0.82); font-size: 14px; line-height: 1.35; }',
  '.vz-camera.vz-nocam .vz-guide, .vz-camera.vz-nocam .vz-shutter, .vz-camera.vz-nocam .vz-overlay { display: none; }',
  '.vz-camera.vz-nocam .vz-bar { top: 0; }',
].join('\n');

interface Engine {
  readonly worker: boolean;
  post(req: LiveRequest, done: (res: LiveResponse) => void): void;
  dispose(): void;
}

/** The finder on the main thread: one request per task, so the page can paint in between. */
function inlineEngine(): Engine {
  const finder = new LiveFinder();
  let chain: Promise<void> = Promise.resolve();
  let dead = false;
  return {
    worker: false,
    post(req, done) {
      chain = chain.then(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              if (!dead) done(finder.handle(req));
              resolve();
            }, 0);
          }),
      );
    },
    dispose() {
      dead = true;
    },
  };
}

/** The finder in a Web Worker. Falls back to the main thread when the worker cannot be started or fails. */
function workerEngine(): Engine {
  let worker: Worker | null = null;
  let fallback: Engine | null = null;
  const waiting = new Map<number, { req: LiveRequest; done: (res: LiveResponse) => void }>();
  const fail = (): void => {
    if (fallback) return;
    fallback = inlineEngine();
    worker?.terminate();
    worker = null;
    // Requests whose pixels went to the worker are lost with it: answer them as "nothing found".
    for (const [id, w] of waiting) w.done({ id, found: false, points: [], score: 0, confidence: 0, tracked: false, samples: null, ms: 0, width: w.req.width, height: w.req.height, data: new Uint8ClampedArray(w.req.width * w.req.height * 4) });
    waiting.clear();
  };
  try {
    worker = new Worker(new URL('./live-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<LiveResponse>): void => {
      const w = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (w) w.done(e.data);
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
  } catch {
    fallback = inlineEngine();
  }
  return {
    get worker() {
      return !fallback;
    },
    post(req, done) {
      if (fallback || !worker) {
        (fallback as Engine).post(req, done);
        return;
      }
      waiting.set(req.id, { req, done });
      try {
        worker.postMessage(req, [req.data.buffer as ArrayBuffer]);
      } catch {
        waiting.delete(req.id);
        fail();
        (fallback as unknown as Engine).post(req, done);
      }
    },
    dispose() {
      worker?.terminate();
      worker = null;
      fallback?.dispose();
      waiting.clear();
    },
  };
}

interface BurstFrame {
  image: ImageData;
  points: number[];
  score: number;
  samples: RawSample[];
}

export class CameraCapture {
  private readonly root: HTMLDivElement;
  private readonly video: HTMLVideoElement;
  private readonly guide: HTMLDivElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly shutter: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly note: HTMLDivElement;
  private readonly observer: ResizeObserver | null = null;
  private stream: MediaStream | null = null;
  private pending: { resolve: (f: CapturedFrame) => void; reject: (e: Error) => void } | null = null;
  private readonly guideFraction: number;
  private mode: CaptureMode;
  private auto: boolean;
  private live: boolean;
  private avoid: readonly FaceSample[];
  private readonly steady: SteadyTimer;
  private engine: Engine | null = null;
  private small: HTMLCanvasElement | null = null;
  private raf = 0;
  private running = false;
  /** A frame is with the finder. */
  private busy = false;
  /** A photo was delivered (or is being worked out): the live loop rests until capture() is called again. */
  private held = false;
  private steadyPhase = false;
  private resetNext = true;
  /** The countdown has run out: the next frame is searched afresh, and the photo is taken only if that search agrees. */
  private confirmNext = false;
  private lastSent = 0;
  private nextId = 1;
  private burst: BurstFrame[] = [];
  private shown: { points: Point[]; locked: boolean; progress: number } | null = null;
  private lastStatus: CameraStatus | null = null;
  private lastEmit = 0;
  private destroyed = false;
  private readonly timing = { frames: 0, totalMs: 0, maxMs: 0, searches: 0, searchMs: 0, since: 0 };

  constructor(
    container: HTMLElement,
    private readonly options: CameraCaptureOptions = {},
  ) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.guideFraction = options.guideFraction ?? 0.8;
    this.mode = options.mode ?? 'face';
    this.auto = options.auto === true;
    this.live = options.live ?? this.auto;
    this.avoid = options.avoid ?? [];
    this.steady = new SteadyTimer(options.steadyMs ?? 600);
    this.root = document.createElement('div');
    this.root.className = 'vz-camera vz-nocam';
    if (this.live || options.mode || options.onStatus) this.root.classList.add('vz-fill');
    if (this.live) this.root.classList.add('vz-live');
    this.video = document.createElement('video');
    this.video.setAttribute('aria-label', 'Camera view');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.setAttribute('playsinline', '');
    this.guide = document.createElement('div');
    this.guide.className = 'vz-guide';
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'vz-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.note = document.createElement('div');
    this.note.className = 'vz-note';
    this.note.hidden = true;
    this.note.setAttribute('role', 'status');
    const bar = document.createElement('div');
    bar.className = 'vz-bar';
    this.shutter = document.createElement('button');
    this.shutter.type = 'button';
    this.shutter.className = 'vz-shutter';
    this.shutter.setAttribute('aria-label', 'Take photo');
    this.shutter.disabled = true;
    const fileLabel = document.createElement('label');
    fileLabel.className = 'vz-file';
    const fileText = document.createElement('span');
    fileText.textContent = 'Choose a photo';
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.setAttribute('capture', 'environment');
    this.fileInput.setAttribute('aria-label', 'Choose or take a photo');
    fileLabel.append(fileText, this.fileInput);
    bar.append(this.shutter, fileLabel);
    this.root.append(this.video, this.guide, this.overlay, this.note, bar);
    container.appendChild(this.root);
    this.shutter.addEventListener('click', this.onShutter);
    this.fileInput.addEventListener('change', this.onFile);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.placeGuide());
      this.observer.observe(this.root);
    }
    this.placeGuide();
  }

  /** Opens the rear camera. Resolves either way: without a camera the file fallback stays available and onError is told why. */
  async start(): Promise<void> {
    this.stop();
    this.emit('starting', 'starting', 0, 0);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(window.isSecureContext ? 'This browser has no camera access.' : 'The camera needs a secure (https) page.');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (this.destroyed) {
        for (const t of this.stream.getTracks()) t.stop();
        this.stream = null;
        return;
      }
      this.video.srcObject = this.stream;
      await this.video.play();
      this.root.classList.remove('vz-nocam');
      this.shutter.disabled = false;
      this.note.hidden = true;
      this.placeGuide();
      this.running = true;
      this.held = false;
      this.resetLive();
      this.timing.since = performance.now();
      if (this.live) {
        this.emit('searching', 'not-found', 0, 0);
        this.schedule();
      }
    } catch (e) {
      this.stop();
      const name = (e as { name?: string }).name || '';
      const message =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Camera permission was not given. Use "Choose a photo" to take or pick a picture instead.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No camera was found. Use "Choose a photo" instead.'
            : ((e as Error).message || 'The camera could not be started.') + ' Use "Choose a photo" instead.';
      this.note.textContent = message;
      this.note.hidden = false;
      this.emit('no-camera', 'no-camera', 0, 0, message);
      this.options.onError?.(message);
    }
  }

  /**
   * Resolves when a photo is taken: by the camera itself (auto), by the shutter, or from a file.
   * One capture can be pending at a time. Calling it again after a photo resumes the live view.
   */
  capture(): Promise<CapturedFrame> {
    if (this.pending) this.pending.reject(new Error('superseded by a newer capture() call'));
    if (this.held) {
      this.held = false;
      this.resetLive();
      if (this.running) {
        void this.video.play().catch(() => undefined);
        if (this.live) {
          this.emit('searching', 'not-found', 0, 0);
          this.schedule();
        }
      }
    }
    return new Promise<CapturedFrame>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  /** Switches between one face and a corner shot without reopening the camera. */
  setMode(mode: CaptureMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.resetLive();
    this.placeGuide();
  }

  /** Turns automatic capture on or off. Turning it on also turns live finding on. */
  setAuto(on: boolean): void {
    this.auto = on;
    if (on && !this.live) {
      this.live = true;
      this.root.classList.add('vz-live', 'vz-fill');
      this.placeGuide();
      if (this.running && !this.held) this.schedule();
    }
    this.resetLive();
  }

  /** Replaces the faces that automatic capture must not take again. */
  setAvoid(samples: readonly FaceSample[]): void {
    this.avoid = samples;
  }

  /** The guide square in the pixel coordinates of a frame of the given size, as the user sees it now. */
  guideQuad(frameWidth: number, frameHeight: number): Quad {
    const cw = this.root.clientWidth;
    const ch = this.root.clientHeight;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!cw || !ch || !vw || !vh) return centredSquareQuad(frameWidth, frameHeight, this.guideFraction);
    // object-fit: cover
    const scale = Math.max(cw / vw, ch / vh);
    const offX = (cw - vw * scale) / 2;
    const offY = (ch - vh * scale) / 2;
    const side = Math.min(cw, ch) * this.guideFraction;
    const x0 = (cw - side) / 2;
    const y0 = (ch - side) / 2;
    const k = frameWidth / vw;
    const map = (x: number, y: number) => ({ x: ((x - offX) / scale) * k, y: ((y - offY) / scale) * k });
    return [map(x0, y0), map(x0 + side, y0), map(x0 + side, y0 + side), map(x0, y0 + side)];
  }

  /** How the live finder is doing: frames looked at, time per frame, and whether it runs in a worker. For measuring. */
  liveStats(): { frames: number; meanMs: number; maxMs: number; searches: number; meanSearchMs: number; perSecond: number; worker: boolean } {
    const t = this.timing;
    const seconds = Math.max(1e-3, (performance.now() - t.since) / 1000);
    return { frames: t.frames, meanMs: t.frames ? t.totalMs / t.frames : 0, maxMs: t.maxMs, searches: t.searches, meanSearchMs: t.searches ? t.searchMs / t.searches : 0, perSecond: t.frames / seconds, worker: !!this.engine && this.engine.worker };
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.shutter.disabled = true;
    this.root.classList.add('vz-nocam');
    this.shown = null;
    this.drawOverlay();
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
    this.engine?.dispose();
    this.engine = null;
    this.observer?.disconnect();
    this.shutter.removeEventListener('click', this.onShutter);
    this.fileInput.removeEventListener('change', this.onFile);
    if (this.pending) this.pending.reject(new Error('camera closed'));
    this.pending = null;
    this.root.remove();
  }

  // ---- geometry --------------------------------------------------------------------------------

  /** How the video frame sits in the view (object-fit: cover): scale and offset in CSS pixels per frame pixel. */
  private cover(): { scale: number; offX: number; offY: number; cw: number; ch: number; vw: number; vh: number } | null {
    const cw = this.root.clientWidth;
    const ch = this.root.clientHeight;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!cw || !ch || !vw || !vh) return null;
    const scale = Math.max(cw / vw, ch / vh);
    return { scale, offX: (cw - vw * scale) / 2, offY: (ch - vh * scale) / 2, cw, ch, vw, vh };
  }

  /** The guide in pixels of an image that is the video frame scaled to the given width, or null when no guide is shown. */
  private guideIn(imageWidth: number, imageHeight: number): Point[] | null {
    if (this.options.guide === false) return null;
    if (this.mode === 'face') return this.guideQuad(imageWidth, imageHeight);
    const c = this.cover();
    if (!c) return null;
    const k = imageWidth / c.vw;
    const size = Math.min(c.cw, c.ch) * this.guideFraction;
    return guideCornerOutline(c.cw / 2, c.ch / 2, size).map((p) => ({ x: ((p.x - c.offX) / c.scale) * k, y: ((p.y - c.offY) / c.scale) * k }));
  }

  private placeGuide(): void {
    const cw = this.root.clientWidth;
    const ch = this.root.clientHeight;
    const side = Math.min(cw, ch) * this.guideFraction;
    Object.assign(this.guide.style, { width: side + 'px', height: side + 'px', left: (cw - side) / 2 + 'px', top: (ch - side) / 2 + 'px' });
    this.guide.style.display = this.options.guide === false || this.mode !== 'face' ? 'none' : '';
    this.drawOverlay();
  }

  // ---- live loop -------------------------------------------------------------------------------

  private resetLive(): void {
    this.steady.reset();
    this.burst = [];
    this.steadyPhase = false;
    this.resetNext = true;
    this.shown = null;
    this.setProgress(0);
    this.drawOverlay();
  }

  private ensureEngine(): Engine {
    if (!this.engine) this.engine = this.options.worker === false || typeof Worker === 'undefined' ? inlineEngine() : workerEngine();
    return this.engine;
  }

  private schedule(): void {
    if (this.raf || !this.running || this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.raf = 0;
    if (!this.running || !this.live || this.held) return;
    this.schedule();
    const t = performance.now();
    if (this.busy || t - this.lastSent < FRAME_GAP || this.video.readyState < 2) return;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;
    let image: ImageData;
    const full = this.steadyPhase && this.auto;
    try {
      if (full) image = toImageData(this.video, vw, vh, WORKING_SIZE);
      else {
        const k = Math.min(1, LIVE_SIDE / Math.max(vw, vh));
        const w = Math.max(1, Math.round(vw * k));
        const h = Math.max(1, Math.round(vh * k));
        if (!this.small) this.small = document.createElement('canvas');
        if (this.small.width !== w || this.small.height !== h) {
          this.small.width = w;
          this.small.height = h;
        }
        const ctx = this.small.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        ctx.drawImage(this.video, 0, 0, w, h);
        image = ctx.getImageData(0, 0, w, h);
      }
    } catch {
      return;
    }
    const guide = this.guideIn(image.width, image.height);
    const req: LiveRequest = {
      id: this.nextId++,
      kind: 'frame',
      mode: this.mode,
      width: image.width,
      height: image.height,
      data: image.data,
      near: guide ? guide.flatMap((p) => [p.x, p.y]) : null,
      samples: full,
      verify: full && this.burst.length === 0,
      reset: this.resetNext,
      confirm: full && this.confirmNext,
    };
    this.confirmNext = false;
    this.resetNext = false;
    this.busy = true;
    this.lastSent = t;
    const mode = this.mode;
    this.ensureEngine().post(req, (res) => {
      this.busy = false;
      if (this.destroyed || !this.running || this.held || mode !== this.mode) return;
      this.onLive(res, guide);
    });
  };

  private onLive(res: LiveResponse, guide: Point[] | null): void {
    const t = this.timing;
    t.frames++;
    t.totalMs += res.ms;
    t.maxMs = Math.max(t.maxMs, res.ms);
    if (!res.tracked) {
      t.searches++;
      t.searchMs += res.ms;
    }
    const c = this.cover();
    if (!c) return;
    const lost = (): void => {
      this.steady.reset();
      this.burst = [];
      this.steadyPhase = false;
      this.confirmNext = false;
      this.setProgress(0);
    };
    if (!res.found || res.confidence < GATES.show) {
      lost();
      this.shown = null;
      this.drawOverlay();
      this.emit('searching', 'not-found', 0, 0);
      return;
    }
    const k = res.width / c.vw;
    const pts: Point[] = [];
    for (let i = 0; i < res.points.length; i += 2) pts.push({ x: res.points[i] as number, y: res.points[i + 1] as number });
    const toView = (p: Point): Point => ({ x: c.offX + (p.x / k) * c.scale, y: c.offY + (p.y / k) * c.scale });
    const view = { x0: (-c.offX / c.scale) * k, y0: (-c.offY / c.scale) * k, x1: ((c.cw - c.offX) / c.scale) * k, y1: ((c.ch - c.offY) / c.scale) * k };
    const verdict = this.mode === 'face' ? assessFace(pts, res.confidence, guide, view) : assessCorner(pts, res.confidence, guide, view);
    const viewPts = pts.map(toView);
    if (!verdict.ok) {
      lost();
      this.shown = { points: viewPts, locked: false, progress: 0 };
      this.drawOverlay();
      this.emit('adjust', verdict.code, 0, res.confidence);
      return;
    }
    const xs = pts.map((p) => p.x);
    const size = (Math.max(...xs) - Math.min(...xs)) / res.width;
    const st = this.steady.add(
      performance.now(),
      pts.flatMap((p) => [p.x / res.width, p.y / res.width]),
      size,
    );
    if (st.moved) this.burst = [];
    if (res.confirmed === false || (res.confirmed && st.moved)) {
      // A fresh search of this frame did not arrive at the outline that was being followed: start over.
      lost();
      this.shown = { points: viewPts, locked: false, progress: 0 };
      this.drawOverlay();
      this.emit('adjust', 'unsure', 0, res.confidence);
      return;
    }
    this.steadyPhase = true;
    if (res.samples) {
      if (this.avoid.length && looksAlreadyCaptured(res.samples.map(toFaceSample), this.avoid)) {
        lost();
        this.shown = { points: viewPts, locked: false, progress: 0 };
        this.drawOverlay();
        this.emit('adjust', 'same-side', 0, res.confidence);
        return;
      }
      this.burst.push({ image: new ImageData(res.data as Uint8ClampedArray<ArrayBuffer>, res.width, res.height), points: res.points, score: res.score, samples: res.samples });
      if (this.burst.length > BURST) {
        let worst = 0;
        for (let i = 1; i < this.burst.length; i++) if ((this.burst[i] as BurstFrame).score < (this.burst[worst] as BurstFrame).score) worst = i;
        this.burst.splice(worst, 1);
      }
    }
    const progress = this.auto ? st.progress : 0;
    this.shown = { points: viewPts, locked: true, progress };
    this.setProgress(progress);
    this.drawOverlay();
    this.emit('steady', st.moved ? 'moving' : 'hold', progress, res.confidence);
    if (!this.auto || !this.pending || st.progress < 1 || this.burst.length === 0) return;
    if (res.confirmed) this.fire();
    else this.confirmNext = true;
  }

  private fire(): void {
    let best = this.burst[0] as BurstFrame;
    for (const b of this.burst) if (b.score > best.score) best = b;
    const faces = best.samples.length;
    const samples: FaceSample[] = [];
    for (let f = 0; f < faces; f++) samples.push(fuseSamples(this.burst.filter((b) => b.samples.length === faces).map((b) => b.samples[f] as RawSample)));
    const confidence = confidenceOf(best.score);
    this.held = true;
    this.video.pause();
    this.burst = [];
    this.setProgress(1);
    if (this.shown) this.shown.progress = 1;
    this.drawOverlay();
    this.emit('captured', 'captured', 1, confidence);
    this.deliver(this.frameOf(best.image, best.points, confidence, 'auto', samples));
  }

  private frameOf(image: ImageData, points: readonly number[], confidence: number, source: CapturedFrame['source'], samples: FaceSample[] | undefined): CapturedFrame {
    const pts: Point[] = [];
    for (let i = 0; i < points.length; i += 2) pts.push({ x: points[i] as number, y: points[i + 1] as number });
    if (this.mode === 'corner' && pts.length === 7) {
      const outline = pts as CornerOutline;
      return { image, quad: cornerQuads(outline)[0], mode: 'corner', outline, confidence, auto: source === 'auto', source, samples };
    }
    return { image, quad: pts.slice(0, 4) as Quad, mode: this.mode, confidence, auto: source === 'auto', source, samples };
  }

  /** Searches a still photo thoroughly and delivers it. */
  private still(image: ImageData, source: 'shutter' | 'file', near: Point[] | null): void {
    const mode = this.mode;
    const fallbackQuad = near && near.length === 4 ? (near as Quad) : centredSquareQuad(image.width, image.height, this.guideFraction);
    const req: LiveRequest = { id: this.nextId++, kind: 'still', mode, width: image.width, height: image.height, data: image.data, near: near ? near.flatMap((p) => [p.x, p.y]) : null, samples: true, verify: true, reset: source === 'file' };
    this.ensureEngine().post(req, (res) => {
      if (this.destroyed) return;
      const picture = new ImageData(res.data as Uint8ClampedArray<ArrayBuffer>, res.width, res.height);
      if (res.found && res.points.length === (mode === 'face' ? 8 : 14)) {
        this.deliver(this.frameOf(picture, res.points, res.confidence, source, res.samples ? res.samples.map(toFaceSample) : undefined));
      } else if (mode === 'corner') {
        const outline = guideCornerOutline(picture.width / 2, picture.height / 2, Math.min(picture.width, picture.height) * 0.7);
        this.deliver({ image: picture, quad: cornerQuads(outline)[0], mode, outline, confidence: 0, auto: false, source });
      } else {
        this.deliver({ image: picture, quad: fallbackQuad, mode, confidence: 0, auto: false, source });
      }
    });
  }

  private readonly onShutter = (): void => {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;
    try {
      const image = toImageData(this.video, vw, vh, WORKING_SIZE);
      if (!this.live) {
        // Version 1 behaviour: the photo with the guide square; the app looks for the face near it.
        if (this.mode === 'corner') {
          const found = findCorner(image);
          this.deliver({ image, quad: cornerQuads(found.outline)[0], mode: 'corner', outline: found.outline, confidence: found.confidence, auto: false, source: 'shutter' });
        } else this.deliver({ image, quad: this.guideQuad(image.width, image.height), mode: 'face', confidence: 0, auto: false, source: 'shutter' });
        return;
      }
      this.held = true;
      this.video.pause();
      this.emit('captured', 'captured', 1, this.lastStatus ? this.lastStatus.confidence : 0);
      this.still(image, 'shutter', this.guideIn(image.width, image.height));
    } catch (e) {
      this.fail((e as Error).message || 'The photo could not be taken.');
    }
  };

  private readonly onFile = async (): Promise<void> => {
    const file = this.fileInput.files && this.fileInput.files[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      const image = await loadImageFile(file);
      if (this.live) {
        this.held = true;
        this.still(image, 'file', null);
      } else if (this.mode === 'corner') {
        const found = findCorner(image);
        this.deliver({ image, quad: cornerQuads(found.outline)[0], mode: 'corner', outline: found.outline, confidence: found.confidence, auto: false, source: 'file' });
      } else {
        const found = findFace(image);
        this.deliver({ image, quad: found.quad, mode: 'face', confidence: found.confidence, auto: false, source: 'file' });
      }
    } catch (e) {
      this.fail((e as Error).message || 'This photo could not be opened.');
    }
  };

  private deliver(frame: CapturedFrame): void {
    const p = this.pending;
    this.pending = null;
    if (p) p.resolve(frame);
  }

  private fail(message: string): void {
    this.note.textContent = message;
    this.note.hidden = false;
    this.options.onError?.(message);
  }

  // ---- what the user sees ----------------------------------------------------------------------

  private setProgress(p: number): void {
    this.shutter.style.setProperty('--vz-progress', String(Math.max(0, Math.min(1, p))));
  }

  private emit(state: CameraState, code: CameraHintCode, progress: number, confidence: number, hint?: string): void {
    if (!this.options.onStatus) return;
    const t = typeof performance !== 'undefined' ? performance.now() : 0;
    const last = this.lastStatus;
    if (last && last.state === state && last.code === code && t - this.lastEmit < 100 && progress < 1) return;
    const cw = this.root.clientWidth || 1;
    const ch = this.root.clientHeight || 1;
    const outline = this.shown && state !== 'searching' && state !== 'starting' && state !== 'no-camera' ? this.shown.points.map((p) => ({ x: p.x / cw, y: p.y / ch })) : null;
    const status: CameraStatus = { state, code, hint: hint ?? hintText(code, this.mode), progress, outline, confidence };
    this.lastStatus = status;
    this.lastEmit = t;
    this.options.onStatus(status);
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(this.root).getPropertyValue(name).trim();
    return v || fallback;
  }

  /** The guide of a corner shot and the outline that was found, drawn over the video. Locked: solid line. Unsure: dashed line. */
  private drawOverlay(): void {
    const cw = this.root.clientWidth;
    const ch = this.root.clientHeight;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    if (this.overlay.width !== w || this.overlay.height !== h) {
      this.overlay.width = w;
      this.overlay.height = h;
    }
    const g = this.overlay.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    if (!cw || !ch) return;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = (pts: readonly Point[], closed: boolean): void => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      if (closed) g.closePath();
    };
    const cornerLines = (o: readonly Point[]): void => {
      path([o[1], o[2], o[3], o[4], o[5], o[6]] as Point[], true);
      g.stroke();
      for (const i of [2, 4, 6]) {
        path([o[0] as Point, o[i] as Point], false);
        g.stroke();
      }
    };
    if (this.mode === 'corner' && this.options.guide !== false && this.live) {
      const o = guideCornerOutline(cw / 2, ch / 2, Math.min(cw, ch) * this.guideFraction);
      g.setLineDash([]);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      cornerLines(o);
    }
    const s = this.shown;
    if (!s || !this.live) return;
    const colour = s.locked ? this.cssVar('--highlight', '#7df9ff') : this.cssVar('--warn', '#f5b942');
    const draw = (): void => {
      if (s.points.length === 7) cornerLines(s.points);
      else {
        path(s.points, true);
        g.stroke();
      }
    };
    if (s.locked && s.progress > 0) {
      // The countdown fills the outline.
      g.save();
      g.globalAlpha = 0.1 + 0.22 * s.progress;
      g.fillStyle = colour;
      path(s.points.length === 7 ? ([s.points[1], s.points[2], s.points[3], s.points[4], s.points[5], s.points[6]] as Point[]) : s.points, true);
      g.fill();
      g.restore();
    }
    g.setLineDash(s.locked ? [] : [10, 9]);
    g.lineWidth = s.locked ? 7 : 6;
    g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    draw();
    g.lineWidth = s.locked ? 4 : 3;
    g.strokeStyle = colour;
    draw();
    g.setLineDash([]);
  }
}
