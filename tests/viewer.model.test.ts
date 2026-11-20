/**
 * Node tests for the 3D cube model and the move arrows (no browser needed).
 * The browser test in viewer.browser.test.ts repeats the state checks through the real CubeView.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { N, NF, solvedState, cubieFaceletIndex, faceOfNormal, faceletFace, type Vec3 } from '../src/cube/geometry';
import { applyMove, allHalfBlockMoves, randomMoves, makeRng, moveToString, type Move, type Axis } from '../src/cube/moves';
import { CubeModel } from '../src/viewer/model';
import { buildMoveIndicator } from '../src/viewer/indicator';

const PALETTE = ['#f3f3ef', '#d92b2b', '#2dbd4e', '#ffd41f', '#ff8a1c', '#1f6fe0'];

function randomState(rand: () => number): Uint8Array {
  let s = solvedState();
  for (const m of randomMoves(60, rand)) s = applyMove(s, m);
  return s;
}

function labelled(): Uint8Array {
  const s = new Uint8Array(NF);
  for (let i = 0; i < NF; i++) s[i] = i;
  return s;
}

function everyBlockMove(): Move[] {
  const out: Move[] = [];
  for (let axis = 0 as Axis; axis < 3; axis++)
    for (let lo = 0; lo < N; lo++) for (let hi = lo; hi < N; hi++) for (let q = 1; q <= 3; q++) out.push({ axis, lo, hi, q });
  return out;
}

/** Facelet under a point on the cube surface (cube frame, faces at +-3) with the given outward normal. */
function faceletAt(point: THREE.Vector3, normal: THREE.Vector3): number {
  const n: Vec3 = [Math.round(normal.x), Math.round(normal.y), Math.round(normal.z)];
  const c = [point.x, point.y, point.z].map((v, k) => (n[k] === 1 ? N - 1 : n[k] === -1 ? 0 : Math.min(N - 1, Math.max(0, Math.floor(v + N / 2)))));
  return cubieFaceletIndex(faceOfNormal(n), c[0] as number, c[1] as number, c[2] as number);
}

describe('CubeModel', () => {
  it('reads back the state it was given, including unknown stickers', () => {
    const model = new CubeModel();
    const state = randomState(makeRng(1));
    state[5] = 255;
    state[100] = 9;
    model.setState(state, PALETTE);
    expect(Array.from(model.getState())).toEqual(Array.from(state));
    const ids = labelled();
    model.setState(ids, PALETTE);
    expect(Array.from(model.getState())).toEqual(Array.from(ids));
  });

  it('matches the engine for every block move (189), applied at once and through hold/turn/commit', () => {
    const model = new CubeModel();
    const rand = makeRng(7);
    let checked = 0;
    for (const m of everyBlockMove()) {
      const state = labelled();
      const expected = Array.from(applyMove(state, m));
      model.setState(state, PALETTE);
      model.applyMove(m);
      expect(Array.from(model.getState()), 'instant ' + moveToString(m)).toEqual(expected);
      for (const lifted of [false, true]) {
        const start = randomState(rand);
        model.setState(start, PALETTE);
        model.hold(m, lifted);
        expect(Array.from(model.getState()), 'held ' + moveToString(m)).toEqual(Array.from(start));
        model.setTurn(0.37);
        model.setTurn(1);
        model.commit();
        expect(Array.from(model.getState()), 'turned ' + moveToString(m)).toEqual(Array.from(applyMove(start, m)));
      }
      checked++;
    }
    expect(checked).toBe(189);
  });

  it('stays exact over 3000 random moves (no drift)', () => {
    const model = new CubeModel();
    let state = labelled();
    model.setState(state, PALETTE);
    const moves = randomMoves(3000, makeRng(99));
    moves.forEach((m, i) => {
      if (i % 2) model.applyMove(m);
      else {
        model.hold(m, i % 4 === 0);
        model.setTurn(1);
        model.commit();
      }
      state = applyMove(state, m);
    });
    expect(Array.from(model.getState())).toEqual(Array.from(state));
    model.root.traverse((o) => {
      if (o.parent !== model.root || !(o as THREE.Group).isGroup || o === model.pivot) return;
      for (const v of o.position.toArray()) expect(Math.abs(v * 2 - Math.round(v * 2))).toBe(0);
      const e = new THREE.Matrix4().makeRotationFromQuaternion(o.quaternion).elements;
      for (const v of e) expect(Math.min(Math.abs(v), Math.abs(Math.abs(v) - 1))).toBeLessThan(1e-12);
    });
  });

  it('a released block goes back untouched', () => {
    const model = new CubeModel();
    const state = randomState(makeRng(3));
    model.setState(state, PALETTE);
    model.hold({ axis: 0, lo: 3, hi: 4, q: 1 }, true);
    model.setTurn(0.6);
    model.release();
    expect(Array.from(model.getState())).toEqual(Array.from(state));
  });

  it('getState is read in the cube frame, so a whole-cube pose does not change it', () => {
    const model = new CubeModel();
    const state = randomState(makeRng(4));
    model.setState(state, PALETTE);
    model.root.quaternion.setFromEuler(new THREE.Euler(0.4, 1.3, -0.7));
    expect(Array.from(model.getState())).toEqual(Array.from(state));
  });
});

describe('move arrows', () => {
  it('every arrow of all 108 moves points the way the engine moves the stickers', () => {
    const colours = { arrow: '#fff', arrowEdge: '#000', outline: '#0ff' };
    let ring = 0;
    let cap = 0;
    for (const m of allHalfBlockMoves()) {
      const indicator = buildMoveIndicator(m, colours);
      // One quarter turn in the arrow's direction: q itself for quarter turns, clockwise for a half turn.
      const quarter: Move = { ...m, q: m.q === 3 ? 3 : 1 };
      const after = applyMove(labelled(), quarter);
      const where = (label: number) => after.indexOf(label);
      const rings = indicator.arrows.filter((a) => a.kind === 'ring');
      const caps = indicator.arrows.filter((a) => a.kind === 'cap');
      expect(rings.length, moveToString(m)).toBe(m.q === 2 ? 2 : 4);
      expect(caps.length, moveToString(m)).toBe(m.lo === 0 || m.hi === N - 1 ? 1 : 0);
      for (const a of indicator.arrows) {
        expect(a.heads).toBe(m.q === 2 ? 2 : 1);
        // Every point of the arrow lies on the turning block.
        for (const p of [a.tail, a.mid, a.tip]) {
          if (a.kind === 'cap') continue;
          const layer = Math.floor(p.getComponent(m.axis) + N / 2);
          expect(layer >= m.lo && layer <= m.hi, moveToString(m)).toBe(true);
        }
        if (a.kind === 'ring') {
          // The sticker under the tail travels to the face the arrow leads to.
          const tail = faceletAt(a.tail, a.tailNormal);
          const next = m.q === 2 ? a.midNormal : a.tipNormal;
          const nextFace = faceOfNormal([Math.round(next.x), Math.round(next.y), Math.round(next.z)]);
          expect(faceletFace(tail)).not.toBe(nextFace);
          expect(faceletFace(where(tail)), 'ring ' + moveToString(m)).toBe(nextFace);
          if (m.q === 2) {
            const end = faceOfNormal([Math.round(a.tipNormal.x), Math.round(a.tipNormal.y), Math.round(a.tipNormal.z)]);
            expect(faceletFace(applyMove(labelled(), m).indexOf(tail))).toBe(end);
          }
          ring++;
        } else {
          // On the outer face: the sticker under the tail, turned a quarter, lands where the arrow has
          // swept a quarter turn on from its tail (same side of the face centre as that point).
          const tail = faceletAt(a.tail, a.tailNormal);
          const moved = where(tail);
          expect(faceletFace(moved)).toBe(faceletFace(tail));
          const axis = new THREE.Vector3().setComponent(m.axis, 1);
          const swept = a.tail.clone().applyAxisAngle(axis, (m.q === 3 ? 1 : -1) * (Math.PI / 2));
          expect(moved, 'cap ' + moveToString(m)).toBe(faceletAt(swept, a.tailNormal));
          // ...and the arrow itself runs that way round: tail -> mid -> tip turn in the same sense.
          const turn = new THREE.Vector3().crossVectors(a.tail, a.mid).dot(axis) + new THREE.Vector3().crossVectors(a.mid, a.tip).dot(axis);
          const flatTail = a.tail.clone().setComponent(m.axis, 0);
          const flatSwept = swept.clone().setComponent(m.axis, 0);
          const sense = new THREE.Vector3().crossVectors(flatTail, flatSwept).dot(axis);
          expect(Math.sign(turn), 'cap sense ' + moveToString(m)).toBe(Math.sign(sense));
          cap++;
        }
      }
      indicator.dispose();
    }
    // 72 quarter-turn moves with 4 ring arrows, 36 half-turn moves with 2; 54 moves reach an outer face.
    expect(ring).toBe(72 * 4 + 36 * 2);
    expect(cap).toBe(54);
  });
});
