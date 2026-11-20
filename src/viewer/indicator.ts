/**
 * What showMove draws on top of the turning block: curved arrows that follow the block round the cube,
 * a circular arrow on the block's outer face, and bright outlines along the block's boundaries.
 *
 * Everything is built in the cube's own frame (unlifted), from plain three.js geometry, so it can be
 * tested in Node. Directions come from the same rule as the turn itself: a move rotates its block by
 * moveAngle(move) about its axis, and every arrow travels the way that rotation carries a sticker.
 */
import * as THREE from 'three';
import type { Move } from '../cube/moves';
import { N } from '../cube/geometry';
import { HALF, moveAngle } from './model';

/** One arrow, described by three points on it and the outward face normal at each. Cube frame. */
export interface ArrowInfo {
  kind: 'ring' | 'cap';
  tail: THREE.Vector3;
  mid: THREE.Vector3;
  tip: THREE.Vector3;
  tailNormal: THREE.Vector3;
  midNormal: THREE.Vector3;
  tipNormal: THREE.Vector3;
  /** Number of arrowheads: 1 for a quarter turn, 2 for a half turn. */
  heads: number;
}

export interface MoveIndicator {
  group: THREE.Group;
  arrows: ArrowInfo[];
  /** Where a "180 degrees" badge can sit: a point on an arrow and the outward normal there. */
  badgeAnchors: { point: THREE.Vector3; normal: THREE.Vector3; cap: boolean }[];
  /** Where the layer-number pill can sit: the tail of each arrow that runs round the block. */
  layerAnchors: { point: THREE.Vector3; normal: THREE.Vector3 }[];
  setOpacity(opacity: number): void;
  dispose(): void;
}

export interface IndicatorColours {
  arrow: string;
  arrowEdge: string;
  outline: string;
}

/** Height of the arrow path above the cube centre: just clear of the stickers. */
const PATH_HALF = HALF + 0.06;
/** The path bends round the cube's edges with this radius; small enough that the edge stays underneath. */
const PATH_CORNER = 0.11;
const EDGE_DROP = 0.02;

interface PathPoint {
  /** Position and outward normal in the plane across the axis, as (u, v). */
  u: number;
  v: number;
  nu: number;
  nv: number;
}

const STRAIGHT = PATH_HALF - PATH_CORNER;
const ARC = (Math.PI / 2) * PATH_CORNER;
const QUARTER = 2 * STRAIGHT + ARC;
const PERIMETER = 4 * QUARTER;

/**
 * A rounded square round the axis. s is the distance travelled anticlockwise (from +u toward +v)
 * starting at the middle of the +u side; s = k * QUARTER is the middle of side k.
 */
function pathPoint(s: number): PathPoint {
  const wrapped = ((s % PERIMETER) + PERIMETER) % PERIMETER;
  const k = Math.min(3, Math.floor(wrapped / QUARTER));
  const t = wrapped - k * QUARTER;
  let u: number;
  let v: number;
  let nu: number;
  let nv: number;
  if (t <= STRAIGHT) {
    [u, v, nu, nv] = [PATH_HALF, t, 1, 0];
  } else if (t <= STRAIGHT + ARC) {
    const a = (t - STRAIGHT) / PATH_CORNER;
    [nu, nv] = [Math.cos(a), Math.sin(a)];
    [u, v] = [STRAIGHT + PATH_CORNER * nu, STRAIGHT + PATH_CORNER * nv];
  } else {
    [u, v, nu, nv] = [QUARTER - t, PATH_HALF, 0, 1];
  }
  for (let i = 0; i < k; i++) {
    [u, v] = [-v, u];
    [nu, nv] = [-nv, nu];
  }
  return { u, v, nu, nv };
}

/** Sample distances between a and b, dense enough to follow the corner arcs. */
function sampleRange(a: number, b: number): number[] {
  const out = [a];
  const step = ARC / 5;
  const count = Math.max(1, Math.ceil(Math.abs(b - a) / step));
  for (let i = 1; i <= count; i++) out.push(a + ((b - a) * i) / count);
  return out;
}

interface Profile {
  /** Distance along the arrow from its tail, and the half width there. */
  at: number;
  half: number;
}

/** Half-width profile of an arrow of the given length: a shaft, then one or two triangular heads. */
function arrowProfile(length: number, shaftHalf: number, headHalf: number, headLength: number, heads: number, grow: number): Profile[] {
  const profile: Profile[] = [{ at: -grow, half: shaftHalf + grow }];
  const overlap = headLength * 0.45;
  const firstHead = length - headLength - (heads - 1) * (headLength - overlap);
  for (let h = 0; h < heads; h++) {
    const start = firstHead + h * (headLength - overlap) - grow * 1.2;
    const last = h === heads - 1;
    const end = last ? length + grow * 1.6 : start + (headLength - overlap) + grow * 1.2;
    const endHalf = last ? 0 : ((headHalf + grow * 1.5) * overlap) / headLength;
    if (h === 0) profile.push({ at: start, half: shaftHalf + grow });
    profile.push({ at: start, half: headHalf + grow * 1.5 });
    profile.push({ at: end, half: endHalf });
  }
  return profile;
}

/** Ribbon geometry: for each profile span, strips between centre +- half * side along the samples. */
function ribbon(
  profile: Profile[],
  centre: (at: number) => THREE.Vector3,
  side: (at: number) => THREE.Vector3,
  samples: (a: number, b: number) => number[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const push = (p: THREE.Vector3) => positions.push(p.x, p.y, p.z);
  for (let i = 0; i + 1 < profile.length; i++) {
    const a = profile[i] as Profile;
    const b = profile[i + 1] as Profile;
    if (b.at === a.at) continue;
    const ats = samples(a.at, b.at);
    for (let j = 0; j + 1 < ats.length; j++) {
      const s0 = ats[j] as number;
      const s1 = ats[j + 1] as number;
      const h0 = a.half + ((b.half - a.half) * (s0 - a.at)) / (b.at - a.at);
      const h1 = a.half + ((b.half - a.half) * (s1 - a.at)) / (b.at - a.at);
      const c0 = centre(s0);
      const c1 = centre(s1);
      const d0 = side(s0);
      const d1 = side(s1);
      const l0 = c0.clone().addScaledVector(d0, h0);
      const r0 = c0.clone().addScaledVector(d0, -h0);
      const l1 = c1.clone().addScaledVector(d1, h1);
      const r1 = c1.clone().addScaledVector(d1, -h1);
      push(l0), push(r0), push(l1);
      push(r0), push(r1), push(l1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Basis for an axis: (eu, ev, ea) is right-handed, so anticlockwise about ea runs from eu toward ev. */
function basis(axis: number): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const e = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  return [e[(axis + 1) % 3] as THREE.Vector3, e[(axis + 2) % 3] as THREE.Vector3, e[axis] as THREE.Vector3];
}

export function buildMoveIndicator(move: Move, colours: IndicatorColours): MoveIndicator {
  const [eu, ev, ea] = basis(move.axis);
  const dir = Math.sign(moveAngle(move));
  const heads = move.q === 2 ? 2 : 1;
  const layers = move.hi - move.lo + 1;
  const blockCentre = (move.lo + move.hi + 1) / 2 - HALF;

  const group = new THREE.Group();
  const fill = new THREE.MeshBasicMaterial({ color: colours.arrow, side: THREE.DoubleSide, transparent: true });
  const edge = new THREE.MeshBasicMaterial({ color: colours.arrowEdge, side: THREE.DoubleSide, transparent: true });
  const outline = new THREE.MeshBasicMaterial({ color: colours.outline, transparent: true });
  const geometries: THREE.BufferGeometry[] = [];
  const arrows: ArrowInfo[] = [];
  const badgeAnchors: MoveIndicator['badgeAnchors'] = [];
  const layerAnchors: MoveIndicator['layerAnchors'] = [];

  const addArrow = (
    length: number,
    shaftHalf: number,
    headHalf: number,
    headLength: number,
    centre: (at: number, lift: number) => THREE.Vector3,
    side: (at: number) => THREE.Vector3,
    normal: (at: number) => THREE.Vector3,
    samples: (a: number, b: number) => number[],
    kind: ArrowInfo['kind'],
  ) => {
    const border = 0.075;
    const under = ribbon(arrowProfile(length, shaftHalf, headHalf, headLength, heads, border), (at) => centre(at, -EDGE_DROP), side, samples);
    const over = ribbon(arrowProfile(length, shaftHalf, headHalf, headLength, heads, 0), (at) => centre(at, 0), side, samples);
    geometries.push(under, over);
    const underMesh = new THREE.Mesh(under, edge);
    const overMesh = new THREE.Mesh(over, fill);
    underMesh.renderOrder = 1;
    overMesh.renderOrder = 2;
    group.add(underMesh, overMesh);
    arrows.push({
      kind,
      tail: centre(0, 0),
      mid: centre(length / 2, 0),
      tip: centre(length, 0),
      tailNormal: normal(0),
      midNormal: normal(length / 2),
      tipNormal: normal(length),
      heads,
    });
  };

  // Arrows round the block: each runs from the middle of one side to the middle of the next (a quarter
  // turn) or of the opposite side (a half turn). Half-turn arrows end on the +u and -u sides, so one
  // head always lies on a face that the default view shows.
  // Sized by how many layers turn. The head of a one-layer arrow is a little wider than its layer.
  const shaftHalf = [0.18, 0.22, 0.26][Math.min(layers, 3) - 1] as number;
  const headHalf = [0.56, 0.72, 0.86][Math.min(layers, 3) - 1] as number;
  const headLength = [1.05, 1.25, 1.4][Math.min(layers, 3) - 1] as number;
  const span = heads * QUARTER;
  const tailGap = 0.5;
  const tipGap = 0.22;
  const starts = heads === 2 ? [0, 2] : [0, 1, 2, 3];
  for (const k of starts) {
    const s0 = k * QUARTER + dir * tailGap;
    const length = span - tailGap - tipGap;
    const point = (at: number) => pathPoint(s0 + dir * at);
    const centre = (at: number, lift: number) => {
      const p = point(at);
      return new THREE.Vector3()
        .addScaledVector(eu, p.u + p.nu * lift)
        .addScaledVector(ev, p.v + p.nv * lift)
        .addScaledVector(ea, blockCentre);
    };
    const normal = (at: number) => {
      const p = point(at);
      return new THREE.Vector3().addScaledVector(eu, p.nu).addScaledVector(ev, p.nv);
    };
    addArrow(length, shaftHalf, headHalf, headLength, centre, () => ea, normal, sampleRange, 'ring');
    layerAnchors.push({ point: centre(0.05, 0), normal: normal(0.05) });
    if (heads === 2) {
      // On the shaft: in the middle of the side it crosses, or just behind the heads.
      for (const at of [length / 2, length - 1.75 * headLength - 0.75]) badgeAnchors.push({ point: centre(at, 0), normal: normal(at), cap: false });
    }
  }

  // A circular arrow on each outer face the block reaches.
  for (const end of [-1, 1]) {
    if (end === 1 ? move.hi !== N - 1 : move.lo !== 0) continue;
    const radius = 1.75;
    const sweep = heads === 2 ? 1.72 * Math.PI : 1.4 * Math.PI;
    const length = radius * sweep;
    // Start so that the arrow is centred on the diagonal that points at the default camera.
    const a0 = Math.PI / 4 - (dir * sweep) / 2;
    const outward = ea.clone().multiplyScalar(end);
    const radial = (at: number) => {
      const a = a0 + (dir * at) / radius;
      return new THREE.Vector3().addScaledVector(eu, Math.cos(a)).addScaledVector(ev, Math.sin(a));
    };
    const centre = (at: number, lift: number) => radial(at).multiplyScalar(radius).addScaledVector(outward, PATH_HALF + lift);
    const samples = (a: number, b: number) => {
      const count = Math.max(1, Math.ceil(Math.abs(b - a) / (radius * 0.07)));
      return Array.from({ length: count + 1 }, (_, i) => a + ((b - a) * i) / count);
    };
    addArrow(length, 0.2, 0.56, 1.2, centre, radial, () => outward.clone(), samples, 'cap');
    if (heads === 2) badgeAnchors.push({ point: outward.clone().multiplyScalar(PATH_HALF), normal: outward.clone(), cap: true });
  }

  // Bright outlines along both ends of the block, so the layers can be counted.
  const thickness = 0.085;
  const reach = HALF + 0.035;
  for (const boundary of [move.lo, move.hi + 1]) {
    const inward = boundary === move.lo ? 1 : -1;
    const overhang = 0.012;
    const along = boundary - HALF + (inward * (thickness - overhang)) / 2;
    for (let k = 0; k < 4; k++) {
      const box = new THREE.BoxGeometry(1, 1, 1);
      geometries.push(box);
      const mesh = new THREE.Mesh(box, outline);
      const out = k % 2 === 0 ? eu : ev;
      const across = k % 2 === 0 ? ev : eu;
      const sign = k < 2 ? 1 : -1;
      mesh.position
        .set(0, 0, 0)
        .addScaledVector(out, sign * (reach - 0.1))
        .addScaledVector(ea, along);
      mesh.scale
        .set(0, 0, 0)
        .addScaledVector(out, 0.2)
        .addScaledVector(across, 2 * reach)
        .addScaledVector(ea, thickness + overhang);
      group.add(mesh);
    }
  }

  return {
    group,
    arrows,
    badgeAnchors,
    layerAnchors,
    setOpacity(opacity: number) {
      fill.opacity = edge.opacity = outline.opacity = opacity;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      fill.dispose();
      edge.dispose();
      outline.dispose();
    },
  };
}

/** A bright square frame lying on one face of the cube, for the capture guide. Cube frame. */
export function buildFaceFrame(normal: THREE.Vector3, colour: string): { group: THREE.Group; dispose(): void } {
  const axis = Math.abs(normal.x) > 0.5 ? 0 : Math.abs(normal.y) > 0.5 ? 1 : 2;
  const [eu, ev] = basis(axis);
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: colour });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const width = 0.2;
  const reach = HALF + 0.06;
  for (let k = 0; k < 4; k++) {
    const mesh = new THREE.Mesh(geometry, material);
    const out = k % 2 === 0 ? eu : ev;
    const across = k % 2 === 0 ? ev : eu;
    mesh.position
      .set(0, 0, 0)
      .addScaledVector(out, (k < 2 ? 1 : -1) * (reach - width / 2))
      .addScaledVector(normal, HALF + 0.02);
    mesh.scale
      .set(0, 0, 0)
      .addScaledVector(out, width)
      .addScaledVector(across, 2 * reach)
      .addScaledVector(normal, 0.14);
    mesh.scale.set(Math.abs(mesh.scale.x), Math.abs(mesh.scale.y), Math.abs(mesh.scale.z));
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
