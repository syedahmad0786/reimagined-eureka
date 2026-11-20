/**
 * Shows what was read, on the photo it was read from: the frozen photo cropped around the cube, the
 * grid that was found, and in every cell a filled chip in the colour the app read for that sticker.
 * Chips have a light and a dark ring so they stand out from any photo; an unsure sticker gets a
 * dashed ring and a question mark, so the flag never depends on colour alone. One face for a
 * straight-on photo, three for a corner shot. The view fills its container and owns no buttons.
 */
import { UNSURE_BELOW, type PartialClassification } from './classify';
import { applyMat3, invertMat3, squareToQuad } from './homography';
import type { Point, Quad } from './types';

export interface ReadoutFace {
  /** The face outline in the photo, in reading order (the quad given to sampleFace). */
  quad: Quad;
  /** 36 group ids, row-major: indexes into the palette. */
  groups: ArrayLike<number>;
  /** 36 values 0..1. A sticker below the unsure threshold is flagged. */
  confidence?: ArrayLike<number>;
}

export interface Reading {
  image: ImageData | HTMLCanvasElement;
  /** One face for a straight-on photo, three for a corner shot. */
  faces: readonly ReadoutFace[];
  /** CSS colour per group id. */
  palette: readonly string[];
}

export interface ReadoutOptions {
  /** Confidence below which a sticker is flagged (default UNSURE_BELOW). */
  unsureBelow?: number;
  /** Called when a sticker is tapped: face is the index into reading.faces, cell is 0..35 row-major. */
  onCellTap?: (face: number, cell: number) => void;
  /** Accessible name of the picture. */
  label?: (info: { stickers: number; unsure: number }) => string;
}

/** The Reading of faces of one photo from a provisional classification: shots says which cube face each quad is. */
export function readingFor(image: ImageData | HTMLCanvasElement, shots: readonly { face: number; quad: Quad }[], partial: PartialClassification): Reading {
  const faces: ReadoutFace[] = [];
  for (const s of shots) {
    const f = partial.faces[s.face];
    if (f) faces.push({ quad: s.quad, groups: f.groups, confidence: f.confidence });
  }
  return { image, faces, palette: partial.palette };
}

const STYLE_ID = 'vz-readout-style';
const CSS = [
  '.vz-readout { position: relative; width: 100%; height: 100%; min-height: 160px; border-radius: var(--radius, 14px); overflow: hidden; background: var(--surface, #161a21); touch-action: manipulation; }',
  '.vz-readout canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }',
].join('\n');

export class ReadoutView {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly observer: ResizeObserver | null = null;
  private reading: Reading | null = null;
  private picture: HTMLCanvasElement | null = null;
  private raf = 0;
  private destroyed = false;
  /** Photo pixels to CSS pixels: x_css = ox + x * scale. */
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor(
    container: HTMLElement,
    private readonly options: ReadoutOptions = {},
  ) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'vz-readout';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.root.appendChild(this.canvas);
    container.appendChild(this.root);
    this.canvas.addEventListener('click', this.onClick);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.requestDraw());
      this.observer.observe(this.root);
    }
    this.draw();
  }

  /** Shows a reading, or clears the view with null. */
  setReading(reading: Reading | null): void {
    this.reading = reading;
    this.picture = null;
    if (reading) {
      if (reading.image instanceof HTMLCanvasElement) this.picture = reading.image;
      else {
        const c = document.createElement('canvas');
        c.width = reading.image.width;
        c.height = reading.image.height;
        (c.getContext('2d') as CanvasRenderingContext2D).putImageData(reading.image, 0, 0);
        this.picture = c;
      }
    }
    this.draw();
  }

  /** How many stickers of the current reading are flagged as unsure. */
  unsureCount(): number {
    const limit = this.options.unsureBelow ?? UNSURE_BELOW;
    let n = 0;
    if (this.reading) for (const f of this.reading.faces) if (f.confidence) for (let i = 0; i < 36; i++) if ((f.confidence[i] as number) < limit) n++;
    return n;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.canvas.removeEventListener('click', this.onClick);
    this.root.remove();
  }

  private requestDraw(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private readonly onClick = (e: MouseEvent): void => {
    if (!this.options.onCellTap || !this.reading) return;
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - this.ox) / this.scale;
    const y = (e.clientY - r.top - this.oy) / this.scale;
    for (let f = 0; f < this.reading.faces.length; f++) {
      const p = applyMat3(invertMat3(squareToQuad((this.reading.faces[f] as ReadoutFace).quad)), x, y);
      if (p.x >= 0 && p.x < 1 && p.y >= 0 && p.y < 1) {
        this.options.onCellTap(f, Math.min(5, Math.floor(p.y * 6)) * 6 + Math.min(5, Math.floor(p.x * 6)));
        return;
      }
    }
  };

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(this.root).getPropertyValue(name).trim();
    return v || fallback;
  }

  private draw(): void {
    if (this.destroyed) return;
    const cw = this.root.clientWidth;
    const ch = this.root.clientHeight;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const reading = this.reading;
    const picture = this.picture;
    const unsure = this.unsureCount();
    const stickers = reading ? reading.faces.length * 36 : 0;
    this.canvas.setAttribute('aria-label', this.options.label ? this.options.label({ stickers, unsure }) : reading ? 'The photo with the colour read for each of ' + stickers + ' stickers. ' + (unsure ? unsure + ' are marked as unsure.' : 'None is marked as unsure.') : 'No photo yet.');
    if (!reading || !picture || !cw || !ch) return;
    // Crop: the outlines plus a margin, grown to the shape of the view so the photo fills it.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const f of reading.faces)
      for (const p of f.quad) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    if (!Number.isFinite(x0)) {
      x0 = 0;
      y0 = 0;
      x1 = picture.width;
      y1 = picture.height;
    }
    const pad = 0.07 * Math.max(x1 - x0, y1 - y0);
    x0 -= pad;
    y0 -= pad;
    x1 += pad;
    y1 += pad;
    const scale = Math.min(cw / (x1 - x0), ch / (y1 - y0));
    this.scale = scale;
    this.ox = (cw - (x1 - x0) * scale) / 2 - x0 * scale;
    this.oy = (ch - (y1 - y0) * scale) / 2 - y0 * scale;
    g.imageSmoothingQuality = 'high';
    g.drawImage(picture, this.ox, this.oy, picture.width * scale, picture.height * scale);
    const limit = this.options.unsureBelow ?? UNSURE_BELOW;
    const warn = this.cssVar('--warn', '#f5b942');
    const ink = this.cssVar('--accent-ink', '#051120');
    const font = getComputedStyle(this.root).fontFamily || 'system-ui, sans-serif';
    const at = (p: Point): Point => ({ x: this.ox + p.x * scale, y: this.oy + p.y * scale });
    for (const face of reading.faces) {
      const m = squareToQuad(face.quad);
      // Grid.
      for (const pass of [0, 1]) {
        g.beginPath();
        for (let i = 0; i <= 6; i++) {
          for (const [u0, v0, u1, v1] of [
            [i / 6, 0, i / 6, 1],
            [0, i / 6, 1, i / 6],
          ] as const) {
            const a = at(applyMat3(m, u0, v0));
            const b = at(applyMat3(m, u1, v1));
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
          }
        }
        g.lineWidth = pass === 0 ? 3 : 1.25;
        g.strokeStyle = pass === 0 ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.85)';
        g.stroke();
      }
      // Chips.
      for (let row = 0; row < 6; row++)
        for (let col = 0; col < 6; col++) {
          const i = row * 6 + col;
          const c = at(applyMat3(m, (col + 0.5) / 6, (row + 0.5) / 6));
          const ex = at(applyMat3(m, (col + 1) / 6, (row + 0.5) / 6));
          const ey = at(applyMat3(m, (col + 0.5) / 6, (row + 1) / 6));
          const wx = at(applyMat3(m, col / 6, (row + 0.5) / 6));
          const wy = at(applyMat3(m, (col + 0.5) / 6, row / 6));
          // Half the distance between opposite cell sides, measured across the other axis so a skewed cell does not overflow.
          const cross = Math.abs((ex.x - wx.x) * (ey.y - wy.y) - (ex.y - wx.y) * (ey.x - wy.x));
          const half = Math.min(cross / Math.max(1e-6, Math.hypot(ey.x - wy.x, ey.y - wy.y)), cross / Math.max(1e-6, Math.hypot(ex.x - wx.x, ex.y - wx.y))) / 2;
          const radius = Math.max(3, 0.52 * half);
          const fill = reading.palette[face.groups[i] as number] || '#888';
          const flagged = !!face.confidence && (face.confidence[i] as number) < limit;
          g.beginPath();
          g.arc(c.x, c.y, radius + 2.6, 0, Math.PI * 2);
          g.fillStyle = 'rgba(0, 0, 0, 0.78)';
          g.fill();
          g.beginPath();
          g.arc(c.x, c.y, radius + 1.3, 0, Math.PI * 2);
          g.fillStyle = '#ffffff';
          g.fill();
          g.beginPath();
          g.arc(c.x, c.y, radius, 0, Math.PI * 2);
          g.fillStyle = fill;
          g.fill();
          if (flagged) {
            g.beginPath();
            g.arc(c.x, c.y, radius + 4.6, 0, Math.PI * 2);
            g.setLineDash([4, 3]);
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            g.stroke();
            g.lineWidth = 1.8;
            g.strokeStyle = warn;
            g.stroke();
            g.setLineDash([]);
            g.font = '700 ' + Math.max(9, Math.round(radius * 1.5)) + 'px ' + font;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.lineWidth = 3;
            g.strokeStyle = '#ffffff';
            g.strokeText('?', c.x, c.y + 0.5);
            g.fillStyle = ink;
            g.fillText('?', c.x, c.y + 0.5);
          }
        }
    }
  }
}
