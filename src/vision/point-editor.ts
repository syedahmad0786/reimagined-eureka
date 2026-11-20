/**
 * Shared machinery of QuadEditor and OutlineEditor: a photo with draggable points and 6x6 grids
 * warped to them. Phone first: every point has a 56 px grip that sits beside it, dragging is relative
 * (the point moves by as much as the finger does, so the finger never has to cover it) and a loupe
 * shows the magnified surroundings of the point while it moves. Mouse and keyboard work too: arrow
 * keys nudge the selected point.
 */
import { applyMat3, squareToQuad } from './homography';
import type { Point, Quad } from './types';

export type EditorImage = CanvasImageSource & { width: number; height: number };

export interface PointEditorConfig {
  /** Quads to draw a 6x6 grid in, from the current points. */
  grids: (points: Point[]) => Quad[];
  /**
   * Stroke colour per grid: a CSS colour, or var(--token, fallback), which is read from the page's
   * tokens every time the editor draws.
   */
  gridColours: string[];
  /** Dash pattern per grid (default: a solid line), so that grids differ by more than colour. */
  gridDashes?: number[][];
  /** Short name per grid, drawn in its middle while no point is being dragged. */
  gridNames?: string[];
  /** Direction, in image space, in which the grip of point i sits away from the point (zero for "on the point"). */
  gripDirection: (points: Point[], i: number) => Point;
  /** Short name per point, for screen readers. */
  labels: string[];
}

const GRIP_RADIUS = 28;
const GRIP_OFFSET = 46;
const PAD = 34;
const LOUPE = 132;
const ZOOM = 3;

export class PointEditor {
  protected points: Point[];
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly live: HTMLDivElement;
  private readonly observer: ResizeObserver | null = null;
  private scale = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private active = -1;
  private selected = 0;
  private dragStart: { px: number; py: number; point: Point } | null = null;
  private raf = 0;
  private destroyed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly image: EditorImage,
    points: readonly Point[],
    private readonly notify: (points: Point[]) => void,
    private readonly config: PointEditorConfig,
  ) {
    this.points = points.map((p) => ({ x: p.x, y: p.y }));
    this.root = document.createElement('div');
    this.root.className = 'vz-editor';
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Outline editor. Drag the round grips, or select a point with Tab and move it with the arrow keys.');
    Object.assign(this.root.style, { position: 'relative', width: '100%', touchAction: 'none', userSelect: 'none', outline: 'none', webkitUserSelect: 'none' });
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'The photo with the outline grid drawn on it and ' + this.points.length + ' round grips, one for each point of the outline.');
    Object.assign(this.canvas.style, { display: 'block', width: '100%', borderRadius: 'var(--radius-sm, 9px)', background: 'var(--surface, #161a21)' });
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.live = document.createElement('div');
    this.live.setAttribute('aria-live', 'polite');
    Object.assign(this.live.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' });
    this.root.append(this.canvas, this.live);
    container.appendChild(this.root);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.root.addEventListener('keydown', this.onKey);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.layout());
      this.observer.observe(this.root);
    }
    this.layout();
  }

  protected setPoints(points: readonly Point[]): void {
    this.points = points.map((p) => ({ x: p.x, y: p.y }));
    this.requestDraw();
  }

  protected getPoints(): Point[] {
    return this.points.map((p) => ({ x: p.x, y: p.y }));
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.root.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private layout(): void {
    const width = Math.max(120, this.root.clientWidth || this.container.clientWidth || 320);
    const maxHeight = Math.max(240, Math.min(window.innerHeight * 0.72, 900));
    this.scale = Math.min((width - 2 * PAD) / this.image.width, (maxHeight - 2 * PAD) / this.image.height);
    this.cssWidth = width;
    this.cssHeight = Math.round(this.image.height * this.scale + 2 * PAD);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);
    this.canvas.style.height = this.cssHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private originX(): number {
    return (this.cssWidth - this.image.width * this.scale) / 2;
  }

  private toCss(p: Point): Point {
    return { x: this.originX() + p.x * this.scale, y: PAD + p.y * this.scale };
  }

  private gripCss(i: number): Point {
    const p = this.toCss(this.points[i] as Point);
    const d = this.config.gripDirection(this.points, i);
    const n = Math.hypot(d.x, d.y);
    if (n < 1e-6) return p;
    const g = { x: p.x + (d.x / n) * GRIP_OFFSET, y: p.y + (d.y / n) * GRIP_OFFSET };
    // Keep the grip on the canvas so it can always be reached.
    g.x = Math.max(GRIP_RADIUS, Math.min(this.cssWidth - GRIP_RADIUS, g.x));
    g.y = Math.max(GRIP_RADIUS, Math.min(this.cssHeight - GRIP_RADIUS, g.y));
    return g;
  }

  private eventPos(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const pos = this.eventPos(e);
    let best = -1;
    let bestDist = GRIP_RADIUS + 16;
    for (let i = 0; i < this.points.length; i++) {
      const g = this.gripCss(i);
      const p = this.toCss(this.points[i] as Point);
      const d = Math.min(Math.hypot(pos.x - g.x, pos.y - g.y), Math.hypot(pos.x - p.x, pos.y - p.y) + 6);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) return;
    e.preventDefault();
    this.active = best;
    this.selected = best;
    this.dragStart = { px: pos.x, py: pos.y, point: { ...(this.points[best] as Point) } };
    this.canvas.setPointerCapture(e.pointerId);
    this.root.focus({ preventScroll: true });
    this.requestDraw();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.active < 0 || !this.dragStart) return;
    e.preventDefault();
    const pos = this.eventPos(e);
    this.moveTo(this.active, this.dragStart.point.x + (pos.x - this.dragStart.px) / this.scale, this.dragStart.point.y + (pos.y - this.dragStart.py) / this.scale);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.active < 0) return;
    this.active = -1;
    this.dragStart = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.requestDraw();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 10 : 1;
    const p = this.points[this.selected] as Point;
    if (e.key === 'ArrowLeft') this.moveTo(this.selected, p.x - step / this.scale, p.y);
    else if (e.key === 'ArrowRight') this.moveTo(this.selected, p.x + step / this.scale, p.y);
    else if (e.key === 'ArrowUp') this.moveTo(this.selected, p.x, p.y - step / this.scale);
    else if (e.key === 'ArrowDown') this.moveTo(this.selected, p.x, p.y + step / this.scale);
    else if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const next = this.selected + (e.shiftKey ? -1 : 1);
      if (next < 0 || next >= this.points.length) return; // let focus leave the editor
      this.selected = next;
      this.live.textContent = this.config.labels[next] || 'point ' + (next + 1);
      this.requestDraw();
    } else return;
    e.preventDefault();
  };

  private moveTo(i: number, x: number, y: number): void {
    const p = this.points[i] as Point;
    p.x = Math.max(0, Math.min(this.image.width - 1, x));
    p.y = Math.max(0, Math.min(this.image.height - 1, y));
    this.requestDraw();
    this.notify(this.getPoints());
  }

  private requestDraw(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(this.root).getPropertyValue(name).trim();
    return v || fallback;
  }

  /** The stroke colour of grid qi, with var(--token, fallback) resolved against the page. */
  private gridColour(qi: number): string {
    const spec = this.config.gridColours[qi % this.config.gridColours.length] as string;
    const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(spec.trim());
    return m ? this.cssVar(m[1] as string, (m[2] || '#fff').trim()) : spec;
  }

  private gridDash(qi: number): number[] {
    const d = this.config.gridDashes;
    return d && d.length ? (d[qi % d.length] as number[]) : [];
  }

  private draw(): void {
    if (this.destroyed) return;
    const g = this.ctx;
    const ox = this.originX();
    g.clearRect(0, 0, this.cssWidth, this.cssHeight);
    g.drawImage(this.image, ox, PAD, this.image.width * this.scale, this.image.height * this.scale);
    // Grids.
    const quads = this.config.grids(this.points);
    quads.forEach((quad, qi) => {
      const h = squareToQuad(quad);
      const line = (u0: number, v0: number, u1: number, v1: number) => {
        const a = this.toCss(applyMat3(h, u0, v0));
        const b = this.toCss(applyMat3(h, u1, v1));
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
      };
      for (const pass of [0, 1]) {
        g.beginPath();
        for (let i = 0; i <= 6; i++) {
          line(i / 6, 0, i / 6, 1);
          line(0, i / 6, 1, i / 6);
        }
        g.lineWidth = pass === 0 ? 3.5 : 1.5;
        g.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.55)' : this.gridColour(qi);
        g.setLineDash(pass === 0 ? [] : this.gridDash(qi));
        g.stroke();
      }
      g.setLineDash([]);
    });
    // Names of the grids, out of the way while a point is being moved.
    const names = this.config.gridNames;
    if (names && this.active < 0) {
      g.font = '600 12px ' + (getComputedStyle(this.root).fontFamily || 'system-ui, sans-serif');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      quads.forEach((quad, qi) => {
        const name = names[qi];
        if (!name) return;
        const c = this.toCss(applyMat3(squareToQuad(quad), 0.5, 0.5));
        const w = g.measureText(name).width + 14;
        g.fillStyle = this.cssVar('--accent-ink', '#120616');
        g.globalAlpha = 0.78;
        g.beginPath();
        g.roundRect(c.x - w / 2, c.y - 10, w, 20, 10);
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = this.gridColour(qi);
        g.fillText(name, c.x, c.y + 0.5);
      });
    }
    // Grips.
    const accent = this.cssVar('--accent', '#5aa2ff');
    const highlight = this.cssVar('--highlight', '#7df9ff');
    const ink = this.cssVar('--accent-ink', '#0d1015');
    for (let i = 0; i < this.points.length; i++) {
      const p = this.toCss(this.points[i] as Point);
      const grip = this.gripCss(i);
      const on = i === this.active || (i === this.selected && document.activeElement === this.root);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(grip.x, grip.y);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.stroke();
      g.beginPath();
      g.arc(grip.x, grip.y, GRIP_RADIUS, 0, Math.PI * 2);
      g.fillStyle = on ? highlight : ink;
      g.globalAlpha = on ? 0.3 : 0.45;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = on ? 4 : 3;
      g.strokeStyle = on ? highlight : accent;
      g.stroke();
      g.beginPath();
      g.arc(p.x, p.y, 4, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = '#000';
      g.stroke();
    }
    if (this.active >= 0) this.drawLoupe(quads);
  }

  private drawLoupe(quads: Quad[]): void {
    const g = this.ctx;
    const p = this.points[this.active] as Point;
    const pc = this.toCss(p);
    const grip = this.gripCss(this.active);
    // Park the loupe in a top corner, on the side away from the finger.
    const fingerLeft = Math.min(pc.x, grip.x) < this.cssWidth / 2;
    const fingerTop = Math.min(pc.y, grip.y) < LOUPE + 40;
    const cx = fingerLeft && fingerTop ? this.cssWidth - LOUPE / 2 - 8 : LOUPE / 2 + 8;
    const cy = LOUPE / 2 + 8;
    const src = LOUPE / ZOOM / this.scale; // image pixels shown across the loupe
    g.save();
    g.beginPath();
    g.arc(cx, cy, LOUPE / 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#000';
    g.fillRect(cx - LOUPE / 2, cy - LOUPE / 2, LOUPE, LOUPE);
    g.imageSmoothingEnabled = true;
    const k = LOUPE / src;
    g.drawImage(this.image, cx - p.x * k, cy - p.y * k, this.image.width * k, this.image.height * k);
    // Grid lines inside the loupe.
    const toLoupe = (q: Point): Point => ({ x: cx + (q.x - p.x) * k, y: cy + (q.y - p.y) * k });
    quads.forEach((quad, qi) => {
      const h = squareToQuad(quad);
      g.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = toLoupe(applyMat3(h, i / 6, 0));
        const b = toLoupe(applyMat3(h, i / 6, 1));
        const c = toLoupe(applyMat3(h, 0, i / 6));
        const d = toLoupe(applyMat3(h, 1, i / 6));
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.moveTo(c.x, c.y);
        g.lineTo(d.x, d.y);
      }
      g.lineWidth = 1.5;
      g.strokeStyle = this.gridColour(qi);
      g.setLineDash(this.gridDash(qi));
      g.stroke();
      g.setLineDash([]);
    });
    g.beginPath();
    g.moveTo(cx - 12, cy);
    g.lineTo(cx + 12, cy);
    g.moveTo(cx, cy - 12);
    g.lineTo(cx, cy + 12);
    g.lineWidth = 1;
    g.strokeStyle = '#fff';
    g.stroke();
    g.restore();
    g.beginPath();
    g.arc(cx, cy, LOUPE / 2, 0, Math.PI * 2);
    g.lineWidth = 3;
    g.strokeStyle = this.cssVar('--highlight', '#7df9ff');
    g.stroke();
  }
}
