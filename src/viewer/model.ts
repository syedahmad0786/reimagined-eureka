/**
 * The 3D cube itself, with no renderer, camera or DOM, so it can be tested in Node. Axes and facelet
 * order follow src/cube/geometry.ts exactly. One cubie is one unit wide; the cube is centred on the
 * origin, so the faces sit at +-3.
 *
 * Each of the 152 surface cubies is a group that carries its 1 to 3 sticker meshes; those 216 sticker
 * meshes are the state. The black plastic is drawn as slabs rather than 216 little boxes: one box for
 * the whole cube at rest, and up to three (below the block, the block, above it) while a block is
 * held or turning. That keeps the pixels drawn per frame low, which is what costs on a phone.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { N, NF, FACE_NORMALS, faceletCubie, cubieFaceletIndex } from '../cube/geometry';
import type { Move } from '../cube/moves';

export const HALF = N / 2;
/** How far the highlighted block stands proud of the rest: a scale across the turning axis. */
export const LIFT = 1.045;
const CENTRE = (N - 1) / 2;
const STICKER_SIZE = 0.86;
const STICKER_RADIUS = 0.13;
const STICKER_OFFSET = 0.503;
const UNKNOWN_COLOUR = '#544858';
const PLASTIC_COLOUR = '#0b0c0f';

export const AXIS_VECTORS: readonly THREE.Vector3[] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

interface Sticker {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  colourId: number;
  /** The undimmed colour. */
  base: THREE.Color;
}

interface Cubie {
  group: THREE.Group;
  stickers: Sticker[];
  home: THREE.Vector3;
}

export function checkMove(m: Move): void {
  const ok =
    (m.axis === 0 || m.axis === 1 || m.axis === 2) &&
    Number.isInteger(m.lo) &&
    Number.isInteger(m.hi) &&
    m.lo >= 0 &&
    m.hi < N &&
    m.lo <= m.hi &&
    (m.q === 1 || m.q === 2 || m.q === 3);
  if (!ok) throw new Error('bad move ' + JSON.stringify(m));
}

/** Rotation angle of a move about its axis in right-handed coordinates. A half turn goes the clockwise way. */
export function moveAngle(m: Move): number {
  return m.q === 3 ? Math.PI / 2 : (-m.q * Math.PI) / 2;
}

function roundedSquare(size: number, radius: number): THREE.ShapeGeometry {
  const h = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h + radius, -h);
  shape.lineTo(h - radius, -h);
  shape.absarc(h - radius, -h + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(h, h - radius);
  shape.absarc(h - radius, h - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-h + radius, h);
  shape.absarc(-h + radius, h - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-h, -h + radius);
  shape.absarc(-h + radius, -h + radius, radius, Math.PI, Math.PI * 1.5, false);
  return new THREE.ShapeGeometry(shape, 5);
}

export class CubeModel {
  /** Everything that belongs to the cube. Rotating this rotates the whole cube (capture guide only). */
  readonly root = new THREE.Group();
  /** Holds the block that is highlighted or turning. */
  readonly pivot = new THREE.Group();
  /** Lives in the pivot: anything added here (arrows, outlines) is lifted and turns with the block. */
  readonly decor = new THREE.Group();

  private readonly cubies: Cubie[] = [];
  private readonly stickers: Sticker[] = [];
  private readonly slabGeometries = new Map<string, RoundedBoxGeometry>();
  private slabs: THREE.Mesh[] = [];
  private readonly stickerGeometry = roundedSquare(STICKER_SIZE, STICKER_RADIUS);
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: PLASTIC_COLOUR, roughness: 0.32, metalness: 0 });
  private readonly unknown = new THREE.Color(UNKNOWN_COLOUR);
  /** The move whose block currently sits in the pivot, if any. */
  private held: Move | null = null;

  constructor() {
    this.root.add(this.pivot);
    this.pivot.add(this.decor);
    const zAxis = new THREE.Vector3(0, 0, 1);
    const byPlace = new Map<number, Cubie>();
    for (let i = 0; i < NF; i++) {
      const face = Math.floor(i / (N * N));
      const [x, y, z] = faceletCubie(face, Math.floor((i % (N * N)) / N), i % N);
      const place = (x * N + y) * N + z;
      let cubie = byPlace.get(place);
      if (!cubie) {
        cubie = { group: new THREE.Group(), stickers: [], home: new THREE.Vector3(x - CENTRE, y - CENTRE, z - CENTRE) };
        byPlace.set(place, cubie);
        this.cubies.push(cubie);
        this.root.add(cubie.group);
      }
      const n = FACE_NORMALS[face] as readonly [number, number, number];
      const normal = new THREE.Vector3(n[0], n[1], n[2]);
      const mesh = new THREE.Mesh(this.stickerGeometry, new THREE.MeshBasicMaterial({ color: this.unknown }));
      mesh.position.copy(normal).multiplyScalar(STICKER_OFFSET);
      mesh.quaternion.setFromUnitVectors(zAxis, normal);
      const sticker: Sticker = { mesh, colourId: 255, base: this.unknown.clone() };
      cubie.group.add(mesh);
      cubie.stickers.push(sticker);
      this.stickers.push(sticker);
    }
    this.home();
  }

  private home(): void {
    this.release();
    for (const c of this.cubies) {
      c.group.position.copy(c.home);
      c.group.quaternion.identity();
    }
  }

  /** Draw the plastic as slabs split at the ends of the block of this move, or as one box with null. */
  private buildSlabs(m: Move | null): void {
    for (const slab of this.slabs) slab.removeFromParent();
    this.slabs = [];
    const ranges: [number, number, boolean][] = m ? [[0, m.lo - 1, false], [m.lo, m.hi, true], [m.hi + 1, N - 1, false]] : [[0, N - 1, false]];
    for (const [from, to, turning] of ranges) {
      if (from > to) continue;
      const size = [N, N, N];
      const axis = m ? m.axis : 0;
      size[axis] = to - from + 1;
      const key = size.join('x');
      let geometry = this.slabGeometries.get(key);
      if (!geometry) {
        geometry = new RoundedBoxGeometry(size[0], size[1], size[2], 2, 0.08);
        this.slabGeometries.set(key, geometry);
      }
      const slab = new THREE.Mesh(geometry, this.bodyMaterial);
      slab.position.setComponent(axis, (from + to + 1) / 2 - HALF);
      (turning ? this.pivot : this.root).add(slab);
      this.slabs.push(slab);
    }
  }

  /** Put every cubie back in its home place and paint the stickers from the facelets. */
  setState(facelets: ArrayLike<number>, palette: readonly string[]): void {
    if (facelets.length !== NF) throw new Error('a state needs ' + NF + ' facelets, got ' + facelets.length);
    this.home();
    const colours = palette.map((css) => new THREE.Color(css));
    for (let i = 0; i < NF; i++) {
      const sticker = this.stickers[i] as Sticker;
      const id = facelets[i] as number;
      sticker.colourId = id;
      sticker.base.copy(colours[id] ?? this.unknown);
    }
    this.paint();
  }

  /** The facelets read back from where the sticker meshes are now, in the cube's own frame. */
  getState(): Uint8Array {
    const out = new Uint8Array(NF).fill(255);
    this.root.updateWorldMatrix(true, true);
    const toCube = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const sticker of this.stickers) {
      m.multiplyMatrices(toCube, sticker.mesh.matrixWorld);
      p.setFromMatrixPosition(m);
      n.set(0, 0, 1).transformDirection(m);
      const v = [n.x, n.y, n.z];
      let axis = 0;
      if (Math.abs(v[1] as number) > Math.abs(v[axis] as number)) axis = 1;
      if (Math.abs(v[2] as number) > Math.abs(v[axis] as number)) axis = 2;
      const positive = (v[axis] as number) > 0;
      const face = positive ? [1, 0, 2][axis] : [4, 3, 5][axis];
      const c = [p.x, p.y, p.z].map((value, k) =>
        k === axis ? (positive ? N - 1 : 0) : Math.min(N - 1, Math.max(0, Math.round(value + CENTRE))),
      );
      out[cubieFaceletIndex(face as number, c[0] as number, c[1] as number, c[2] as number)] = sticker.colourId;
    }
    return out;
  }

  /** Cubies whose lattice coordinate along the move's axis lies in lo..hi, read from their positions. */
  private block(m: Move): Cubie[] {
    return this.cubies.filter((c) => {
      const layer = Math.round(c.group.position.getComponent(m.axis) + CENTRE);
      return layer >= m.lo && layer <= m.hi;
    });
  }

  /** Move the block into the pivot so it can be lifted, decorated and turned as one. */
  hold(m: Move, lifted: boolean): void {
    checkMove(m);
    this.release();
    for (const c of this.block(m)) this.pivot.add(c.group);
    this.buildSlabs(m);
    this.held = m;
    this.setLift(lifted ? 1 : 0);
  }

  /** 0 = flush with the cube, 1 = fully lifted. */
  setLift(amount: number): void {
    const s = 1 + (LIFT - 1) * amount;
    this.pivot.scale.set(s, s, s);
    if (this.held) this.pivot.scale.setComponent(this.held.axis, 1);
  }

  /** Turn the held block to this fraction (0..1) of its move. */
  setTurn(fraction: number): void {
    if (!this.held) return;
    this.pivot.quaternion.setFromAxisAngle(AXIS_VECTORS[this.held.axis] as THREE.Vector3, moveAngle(this.held) * fraction);
  }

  /** Put the held block back into the cube where it is now (turn = 0), undoing any partial turn. */
  release(): void {
    if (this.held || this.slabs.length === 0) this.buildSlabs(null);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    for (const child of [...this.pivot.children]) if (child !== this.decor) this.root.add(child);
    this.held = null;
  }

  /** Finish the held block's move: bake the rotation into its cubies, snapped to the lattice. */
  commit(): void {
    const m = this.held;
    if (!m) return;
    this.release();
    this.turn(m);
  }

  /** Apply a move at once. */
  applyMove(m: Move): void {
    checkMove(m);
    this.release();
    this.turn(m);
  }

  private turn(m: Move): void {
    const q = new THREE.Quaternion().setFromAxisAngle(AXIS_VECTORS[m.axis] as THREE.Vector3, moveAngle(m));
    const rot = new THREE.Matrix4();
    for (const c of this.block(m)) {
      const g = c.group;
      g.position.applyQuaternion(q);
      g.position.set(snapHalf(g.position.x), snapHalf(g.position.y), snapHalf(g.position.z));
      g.quaternion.premultiply(q);
      rot.makeRotationFromQuaternion(g.quaternion);
      for (let k = 0; k < 16; k++) rot.elements[k] = Math.round(rot.elements[k] as number);
      g.quaternion.setFromRotationMatrix(rot);
    }
  }

  /** Dim and desaturate every sticker outside the given move's block, or restore all with null. */
  setDim(m: Move | null): void {
    const bright = new Set<Sticker>();
    if (m) for (const c of this.block(m)) for (const s of c.stickers) bright.add(s);
    this.paint(m ? bright : undefined);
  }

  private paint(bright?: Set<Sticker>): void {
    const hsl = { h: 0, s: 0, l: 0 };
    for (const s of this.stickers) {
      const colour = s.mesh.material.color.copy(s.base);
      if (!bright || bright.has(s)) continue;
      colour.getHSL(hsl, THREE.SRGBColorSpace);
      colour.setHSL(hsl.h, hsl.s * 0.55, hsl.l * 0.44 + 0.02, THREE.SRGBColorSpace);
    }
  }

  /** Centre of a facelet's home place on the cube surface, in the cube's own frame. */
  static faceletPoint(face: number, row: number, col: number): THREE.Vector3 {
    const [x, y, z] = faceletCubie(face, row, col);
    const n = FACE_NORMALS[face] as readonly [number, number, number];
    return new THREE.Vector3(x - CENTRE + n[0] * 0.5, y - CENTRE + n[1] * 0.5, z - CENTRE + n[2] * 0.5);
  }

  dispose(): void {
    for (const g of this.slabGeometries.values()) g.dispose();
    this.stickerGeometry.dispose();
    this.bodyMaterial.dispose();
    for (const s of this.stickers) s.mesh.material.dispose();
  }
}

function snapHalf(v: number): number {
  return Math.round(v * 2) / 2;
}
