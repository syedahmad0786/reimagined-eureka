import { cornerQuads } from './corner';
import { PointEditor, type EditorImage } from './point-editor';
import type { CornerOutline, Point } from './types';

/**
 * Like QuadEditor, for a corner shot: seven points (the near corner and the six silhouette corners,
 * see CornerOutline) and three warped 6x6 grids, one per visible face (top cyan, left amber, right
 * magenta).
 */
export class OutlineEditor extends PointEditor {
  constructor(container: HTMLElement, image: EditorImage, outline: CornerOutline, onChange: (outline: CornerOutline) => void) {
    super(container, image, outline, (p) => onChange(p as CornerOutline), {
      grids: (p) => cornerQuads(p as CornerOutline),
      gridColours: ['#7df9ff', '#f5b942', '#ff7ad9'],
      // Silhouette grips sit outside the cube, away from the near corner; the near corner's grip sits on it.
      gripDirection: (p, i) => (i === 0 ? { x: 0, y: 0 } : { x: (p[i] as Point).x - (p[0] as Point).x, y: (p[i] as Point).y - (p[0] as Point).y }),
      labels: ['near corner where the three faces meet', 'back corner', 'top right corner', 'lower right corner', 'bottom corner', 'lower left corner', 'top left corner'],
    });
  }

  setOutline(outline: CornerOutline): void {
    this.setPoints(outline);
  }

  getOutline(): CornerOutline {
    return this.getPoints() as CornerOutline;
  }
}
