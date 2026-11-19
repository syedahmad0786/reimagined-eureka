/**
 * Reference move engine, written independently of src/cube/moves.ts.
 *
 * moves.ts derives permutations by rotating sticker coordinates. This file instead works directly on
 * six 6x6 grids with hand-written rules for which strip goes where. The tests check that both engines
 * agree on every move, and the solver's output is always replayed here before a solution is accepted.
 */
import type { Move } from './moves';

const S = 6;
const M = S - 1;
const FU = 0;
const FR = 1;
const FF = 2;
const FD = 3;
const FL = 4;
const FB = 5;

export class RefCube {
  /** faces[f][row * 6 + col] */
  faces: number[][];

  constructor(facelets?: ArrayLike<number>) {
    this.faces = [];
    for (let f = 0; f < 6; f++) {
      const g: number[] = [];
      for (let i = 0; i < S * S; i++) g.push(facelets ? (facelets[f * S * S + i] as number) : f);
      this.faces.push(g);
    }
  }

  private get(f: number, r: number, c: number): number {
    return (this.faces[f] as number[])[r * S + c] as number;
  }

  private set(f: number, r: number, c: number, v: number): void {
    (this.faces[f] as number[])[r * S + c] = v;
  }

  /** Rotate one face's grid a quarter turn clockwise as seen from outside. */
  private spinFaceClockwise(f: number): void {
    const old = (this.faces[f] as number[]).slice();
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) this.set(f, r, c, old[(M - c) * S + r] as number);
  }

  private spinFace(f: number, clockwiseQuarters: number): void {
    for (let k = 0; k < (clockwiseQuarters & 3); k++) this.spinFaceClockwise(f);
  }

  /** One quarter turn of a single layer, clockwise seen from the positive end of the axis. */
  private quarter(axis: number, layer: number): void {
    if (axis === 1) {
      // Like U: the row at this height travels F -> L -> B -> R -> F, keeping its column order.
      const row = M - layer;
      for (let c = 0; c < S; c++) {
        const f = this.get(FF, row, c);
        this.set(FF, row, c, this.get(FR, row, c));
        this.set(FR, row, c, this.get(FB, row, c));
        this.set(FB, row, c, this.get(FL, row, c));
        this.set(FL, row, c, f);
      }
      if (layer === M) this.spinFace(FU, 1);
      if (layer === 0) this.spinFace(FD, 3);
    } else if (axis === 0) {
      // Like R: the column travels F -> U -> B -> D -> F. On B it appears mirrored in both directions.
      const col = layer;
      for (let r = 0; r < S; r++) {
        const f = this.get(FF, r, col);
        this.set(FF, r, col, this.get(FD, r, col));
        this.set(FD, r, col, this.get(FB, M - r, M - col));
        this.set(FB, M - r, M - col, this.get(FU, r, col));
        this.set(FU, r, col, f);
      }
      if (layer === M) this.spinFace(FR, 1);
      if (layer === 0) this.spinFace(FL, 3);
    } else {
      // Like F: the strip travels U -> R -> D -> L -> U.
      const depth = layer;
      for (let i = 0; i < S; i++) {
        const u = this.get(FU, depth, i);
        this.set(FU, depth, i, this.get(FL, M - i, depth));
        this.set(FL, M - i, depth, this.get(FD, M - depth, M - i));
        this.set(FD, M - depth, M - i, this.get(FR, i, M - depth));
        this.set(FR, i, M - depth, u);
      }
      if (layer === M) this.spinFace(FF, 1);
      if (layer === 0) this.spinFace(FB, 3);
    }
  }

  apply(m: Move): this {
    for (let layer = m.lo; layer <= m.hi; layer++) for (let k = 0; k < (m.q & 3); k++) this.quarter(m.axis, layer);
    return this;
  }

  applyAll(moves: readonly Move[]): this {
    for (const m of moves) this.apply(m);
    return this;
  }

  toFacelets(): Uint8Array {
    const out = new Uint8Array(6 * S * S);
    for (let f = 0; f < 6; f++) out.set(this.faces[f] as number[], f * S * S);
    return out;
  }

  isSolved(): boolean {
    for (let f = 0; f < 6; f++) {
      const g = this.faces[f] as number[];
      for (let i = 1; i < g.length; i++) if (g[i] !== g[0]) return false;
    }
    return true;
  }
}
