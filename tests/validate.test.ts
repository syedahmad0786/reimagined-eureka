import { describe, it, expect } from 'vitest';
import { solvedState, faceletIndex, U, F, R } from '../src/cube/geometry';
import { applyMoves, randomMoves, makeRng, parseMoves } from '../src/cube/moves';
import { randomState } from '../src/cube/random';
import { validateState, suggestFixes, badness } from '../src/cube/validate';
import { deriveScheme, analyseWings } from '../src/cube/scheme';
import { CORNERS, WINGS } from '../src/cube/pieces';

const NAMES = ['white', 'red', 'green', 'yellow', 'orange', 'blue'];

describe('validation', () => {
  it('accepts scrambled cubes and uniformly random states, whatever the colour labels', () => {
    const rand = makeRng(21);
    for (let i = 0; i < 200; i++) {
      const s = i % 2 ? randomState(rand, [3, 5, 0, 1, 4, 2]) : applyMoves(solvedState(), randomMoves(80, rand));
      const v = validateState(s, NAMES);
      expect(v.problems).toEqual([]);
      expect(badness(s)).toBe(0);
    }
  });

  it('finds the colour scheme from the corners for any labelling', () => {
    const s = randomState(makeRng(5), [4, 2, 0, 5, 1, 3]);
    const { scheme } = deriveScheme(s);
    expect(scheme).not.toBeNull();
    expect(scheme!.opposite[4]).toBe(5);
    expect(scheme!.opposite[2]).toBe(1);
    expect(scheme!.opposite[0]).toBe(3);
    expect(scheme!.assignments.length).toBe(24);
  });

  it('wing parity flips with an inner slice quarter turn and not with a face turn', () => {
    const scheme = deriveScheme(solvedState()).scheme!;
    expect(analyseWings(solvedState(), scheme).odd).toEqual([false, false]);
    expect(analyseWings(applyMoves(solvedState(), parseMoves('2R')), scheme).odd).toEqual([true, false]);
    expect(analyseWings(applyMoves(solvedState(), parseMoves('3U')), scheme).odd).toEqual([false, true]);
    expect(analyseWings(applyMoves(solvedState(), parseMoves('R U F')), scheme).odd).toEqual([false, false]);
    expect(analyseWings(applyMoves(solvedState(), parseMoves('3Rw')), scheme).odd).toEqual([true, true]);
  });

  it('reports unset stickers', () => {
    const s = solvedState();
    s[10] = 255;
    const v = validateState(s, NAMES);
    expect(v.ok).toBe(false);
    expect(v.problems[0]!.kind).toBe('unknown');
    expect(v.problems[0]!.facelets).toEqual([10]);
  });

  it('names the colours that are over and under 36, and proposes the single sticker to change', () => {
    const rand = makeRng(8);
    const s = applyMoves(solvedState(), randomMoves(60, rand));
    const f = faceletIndex(F, 2, 3);
    const was = s[f]!;
    const now = (was + 1) % 6;
    s[f] = now;
    const v = validateState(s, NAMES);
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.kind === 'count' && p.message.includes(NAMES[now]! + ' 37') && p.message.includes(NAMES[was]! + ' 35'))).toBe(true);
    expect(v.problems.some((p) => p.kind === 'centre')).toBe(true);
    const fixes = suggestFixes(s, NAMES);
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0]!.solves).toBe(true);
    expect(fixes.some((x) => x.changes.length === 1 && x.changes[0]!.facelet === f && x.changes[0]!.colour === was)).toBe(true);
  });

  it('points at a wrong edge piece and proposes the swap that repairs it', () => {
    const rand = makeRng(9);
    const s = applyMoves(solvedState(), randomMoves(60, rand));
    // swap the colours of two outer-wing stickers on different pieces
    const a = WINGS[0]!.facelets[0];
    let b = -1;
    for (const w of WINGS) if (w.orbit === 0 && s[w.facelets[0]] !== s[a] && w !== WINGS[0]) { b = w.facelets[0]; break; }
    [s[a], s[b]] = [s[b]!, s[a]!];
    const v = validateState(s, NAMES);
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.kind === 'edge' && p.facelets.includes(a))).toBe(true);
    const fixes = suggestFixes(s, NAMES);
    expect(fixes.some((x) => x.solves && x.changes.length === 2 && x.changes.some((c) => c.facelet === a) && x.changes.some((c) => c.facelet === b))).toBe(true);
  });

  it('detects a twisted corner and a corner that does not fit the scheme', () => {
    const s = solvedState();
    const c = CORNERS[0]!;
    const [x, y, z] = c.facelets.map((f) => s[f]!) as [number, number, number];
    s[c.facelets[0]] = z;
    s[c.facelets[1]] = x;
    s[c.facelets[2]] = y;
    expect(validateState(s, NAMES).problems.map((p) => p.kind)).toEqual(['twist']);
    const t = solvedState();
    // mirror a corner: swap two of its stickers
    [t[c.facelets[1]], t[c.facelets[2]]] = [t[c.facelets[2]]!, t[c.facelets[1]]!];
    const v = validateState(t, NAMES);
    expect(v.problems.some((p) => p.kind === 'corner' && p.message.includes('top-right-front corner'))).toBe(true);
  });

  it('recognises a face entered in the wrong orientation', () => {
    const rand = makeRng(10);
    const s = applyMoves(solvedState(), randomMoves(60, rand));
    // rotate the stickers of the R face only (not a legal move)
    const bad = s.slice();
    for (let r = 0; r < 6; r++) for (let c2 = 0; c2 < 6; c2++) bad[faceletIndex(R, r, c2)] = s[faceletIndex(R, 5 - c2, r)]!;
    expect(validateState(bad, NAMES).ok).toBe(false);
    const fixes = suggestFixes(bad, NAMES);
    expect(fixes[0]!.description).toContain('right face');
    const fixed = bad.slice();
    for (const ch of fixes[0]!.changes) fixed[ch.facelet] = ch.colour;
    expect(Array.from(fixed)).toEqual(Array.from(s));
  });
  void U;
});
