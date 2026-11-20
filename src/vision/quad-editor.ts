import { PointEditor, type EditorImage } from './point-editor';
import type { Point, Quad } from './types';

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Shows a photo with four draggable corner grips and a live 6x6 grid warped to the quad, so the user
 * can fix the outline of a face. The quad is in the pixel coordinates of `image`.
 */
export class QuadEditor extends PointEditor {
  constructor(container: HTMLElement, image: EditorImage, quad: Quad, onChange: (quad: Quad) => void) {
    super(container, image, quad, (p) => onChange(p as Quad), {
      grids: (p) => [p as Quad],
      gridColours: ['var(--accent, #7df9ff)'],
      gripDirection: (p, i) => {
        const c = centroid(p);
        return { x: (p[i] as Point).x - c.x, y: (p[i] as Point).y - c.y };
      },
      labels: ['top left corner', 'top right corner', 'bottom right corner', 'bottom left corner'],
    });
  }

  setQuad(quad: Quad): void {
    this.setPoints(quad);
  }

  getQuad(): Quad {
    return this.getPoints() as Quad;
  }
}
