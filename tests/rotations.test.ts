import { describe, it, expect } from 'vitest';
import { NF } from '../src/cube/geometry';
import { applyMove, applyMoves, allHalfBlockMoves, randomMoves, makeRng } from '../src/cube/moves';
import { ROTATIONS, moveToOriginal, rotateState } from '../src/cube/rotations';

describe('whole-cube rotations', () => {
  it('there are 24 distinct ones and each permutes the faces', () => {
    expect(ROTATIONS.length).toBe(24);
    expect(new Set(ROTATIONS.map((r) => Array.from(r.perm).join(','))).size).toBe(24);
    for (const r of ROTATIONS) expect(new Set(r.faceTo).size).toBe(6);
  });
  it('a move on the rotated cube equals the translated move on the original cube', () => {
    const rand = makeRng(3);
    const labelled = new Uint8Array(NF);
    for (let i = 0; i < NF; i++) labelled[i] = i;
    const state = applyMoves(labelled, randomMoves(30, rand));
    for (const rot of ROTATIONS) {
      for (const m of allHalfBlockMoves()) {
        const a = applyMove(rotateState(rot, state), m);
        const b = rotateState(rot, applyMove(state, moveToOriginal(rot, m)));
        expect(Array.from(a)).toEqual(Array.from(b));
      }
    }
  });
});
