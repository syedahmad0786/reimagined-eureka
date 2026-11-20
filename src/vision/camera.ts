/**
 * Live camera with a square 6x6 guide: the user fills the guide with one face and taps the shutter.
 * Uses the rear camera through getUserMedia (needs HTTPS or localhost). When the camera cannot be
 * used, the same control falls back to the phone's own camera or photo picker through a file input.
 */
import { detectFaceQuad } from './detect';
import { centredSquareQuad } from './homography';
import { loadImageFile, toImageData, WORKING_SIZE } from './load';
import type { Quad } from './types';

export interface CameraCaptureOptions {
  onError?: (message: string) => void;
  /** Share of the shorter side of the view that the guide square covers (default 0.8). */
  guideFraction?: number;
  /** Show the square 6x6 guide (default true). Corner shots, which show three faces, turn it off. */
  guide?: boolean;
}

export interface CapturedFrame {
  image: ImageData;
  quad: Quad;
}

const STYLE_ID = 'vz-camera-style';
const CSS = `
.vz-camera { position: relative; width: 100%; aspect-ratio: 3 / 4; max-height: 76vh; background: #000; border-radius: var(--radius, 14px); overflow: hidden; font-family: var(--font, system-ui, sans-serif); color: var(--text, #eef1f5); }
.vz-camera video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.vz-camera .vz-guide { position: absolute; pointer-events: none; box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.42); border: 3px solid var(--highlight, #7df9ff); border-radius: 6px;
  background-image: linear-gradient(to right, rgba(255,255,255,0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.55) 1px, transparent 1px); background-size: calc(100% / 6) calc(100% / 6); }
.vz-camera .vz-bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; gap: var(--gap, 12px); padding: 12px; }
.vz-camera .vz-shutter { width: 76px; height: 76px; border-radius: 50%; border: 5px solid #fff; background: var(--accent, #5aa2ff); cursor: pointer; padding: 0; touch-action: manipulation; }
.vz-camera .vz-shutter:active { transform: scale(0.94); }
.vz-camera .vz-shutter:disabled { opacity: 0.4; }
.vz-camera .vz-shutter:focus-visible, .vz-camera .vz-file:focus-within { outline: 3px solid var(--highlight, #7df9ff); outline-offset: 3px; }
.vz-camera .vz-file { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: var(--tap, 52px); min-width: var(--tap, 52px); padding: 0 16px; border-radius: var(--radius-sm, 9px); background: var(--surface-2, #1e232c); border: 1px solid var(--border, #2c3440); font-size: 15px; cursor: pointer; }
.vz-camera .vz-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
.vz-camera .vz-note { position: absolute; left: 12px; right: 12px; top: 12px; padding: 10px 12px; border-radius: var(--radius-sm, 9px); background: rgba(13, 16, 21, 0.82); font-size: 14px; line-height: 1.35; }
.vz-camera.vz-nocam .vz-guide, .vz-camera.vz-nocam .vz-shutter { display: none; }
.vz-camera.vz-nocam .vz-bar { top: 0; }
`;

export class CameraCapture {
  private readonly root: HTMLDivElement;
  private readonly video: HTMLVideoElement;
  private readonly guide: HTMLDivElement;
  private readonly shutter: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly note: HTMLDivElement;
  private readonly observer: ResizeObserver | null = null;
  private stream: MediaStream | null = null;
  private pending: { resolve: (f: CapturedFrame) => void; reject: (e: Error) => void } | null = null;
  private readonly guideFraction: number;

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
    this.root = document.createElement('div');
    this.root.className = 'vz-camera vz-nocam';
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.setAttribute('playsinline', '');
    this.guide = document.createElement('div');
    this.guide.className = 'vz-guide';
    if (options.guide === false) this.guide.style.display = 'none';
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
    this.root.append(this.video, this.guide, this.note, bar);
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
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(window.isSecureContext ? 'This browser has no camera access.' : 'The camera needs a secure (https) page.');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.root.classList.remove('vz-nocam');
      this.shutter.disabled = false;
      this.note.hidden = true;
      this.placeGuide();
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
      this.options.onError?.(message);
    }
  }

  /** Resolves when the user takes a photo (shutter) or picks a file. One capture can be pending at a time. */
  capture(): Promise<CapturedFrame> {
    if (this.pending) this.pending.reject(new Error('superseded by a newer capture() call'));
    return new Promise<CapturedFrame>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
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

  stop(): void {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.shutter.disabled = true;
    this.root.classList.add('vz-nocam');
  }

  destroy(): void {
    this.stop();
    this.observer?.disconnect();
    this.shutter.removeEventListener('click', this.onShutter);
    this.fileInput.removeEventListener('change', this.onFile);
    if (this.pending) this.pending.reject(new Error('camera closed'));
    this.pending = null;
    this.root.remove();
  }

  private placeGuide(): void {
    const cw = this.root.clientWidth;
    const ch = this.root.clientHeight;
    const side = Math.min(cw, ch) * this.guideFraction;
    Object.assign(this.guide.style, { width: side + 'px', height: side + 'px', left: (cw - side) / 2 + 'px', top: (ch - side) / 2 + 'px' });
  }

  private readonly onShutter = (): void => {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;
    try {
      const image = toImageData(this.video, vw, vh, WORKING_SIZE);
      this.deliver({ image, quad: this.guideQuad(image.width, image.height) });
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
      this.deliver({ image, quad: detectFaceQuad(image).quad });
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
}
