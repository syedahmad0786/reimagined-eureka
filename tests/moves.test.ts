import { describe, it, expect } from 'vitest';
import Cube from 'cubejs';
import { N, NF, NN, U, R, F, D, L, B, faceletIndex, faceletCubie, cubieFaceletIndex, solvedState, isSolved } from '../src/cube/geometry';
import {
  movePerm,
  applyMove,
  applyMoves,
  invertMoves,
  composePerm,
  identityPerm,
  moveToString,
  parseMove,
  parseMoves,
  allHalfBlockMoves,
  randomMoves,
  makeRng,
  type Move,
  type Axis,
} from '../src/cube/moves';
import { RefCube } from '../src/cube/reference';
import { CORNERS, WINGS, CENTRES, FACELET_ORBIT } from '../src/cube/pieces';

function everyBlockMove(): Move[] {
  const out: Move[] = [];
  for (let axis = 0 as Axis; axis < 3; axis++)
    for (let lo = 0; lo < N; lo++) for (let hi = lo; hi < N; hi++) for (let q = 1; q <= 3; q++) out.push({ axis, lo, hi, q });
  return out;
}

function labelled(): Uint8Array {
  const s = new Uint8Array(NF);
  for (let i = 0; i < NF; i++) s[i] = i;
  return s;
}

function cycleLengths(p: Uint8Array): number[] {
  const seen = new Uint8Array(p.length);
  const out: number[] = [];
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    let j = i;
    while (!seen[j]) {
      seen[j] = 1;
      j = p[j] as number;
      len++;
    }
    out.push(len);
  }
  return out;
}

describe('geometry', () => {
  it('maps facelets to cubies and back', () => {
    const seen = new Set<string>();
    for (let f = 0; f < 6; f++)
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const [x, y, z] = faceletCubie(f, r, c);
          expect(cubieFaceletIndex(f, x, y, z)).toBe(faceletIndex(f, r, c));
          seen.add(f + ':' + x + ',' + y + ',' + z);
        }
    expect(seen.size).toBe(NF);
  });
});

describe('move engine', () => {
  it('has 378 block moves, each a true permutation of the 216 facelets', () => {
    const moves = everyBlockMove();
    expect(moves.length).toBe(3 * 21 * 3);
    for (const m of moves) {
      const p = movePerm(m);
      const seen = new Uint8Array(NF);
      for (let i = 0; i < NF; i++) seen[p[i] as number]++;
      for (let i = 0; i < NF; i++) expect(seen[i]).toBe(1);
    }
  });

  it('moves exactly the stickers of the turned layers, in 4-cycles for a quarter turn', () => {
    for (let axis = 0 as Axis; axis < 3; axis++) {
      for (let layer = 0; layer < N; layer++) {
        const p = movePerm({ axis, lo: layer, hi: layer, q: 1 });
        let moved = 0;
        for (let i = 0; i < NF; i++) {
          const cubie = faceletCubie(Math.floor(i / NN), Math.floor((i % NN) / N), i % N);
          if (cubie[axis] === layer) {
            expect(p[i]).not.toBe(i);
            moved++;
          } else {
            expect(p[i]).toBe(i);
          }
        }
        expect(moved).toBe(layer === 0 || layer === N - 1 ? NN + 4 * N : 4 * N);
        for (const len of cycleLengths(p)) expect(len === 1 || len === 4).toBe(true);
      }
    }
  });

  it('half and three-quarter turns are powers of the quarter turn, and four quarters are the identity', () => {
    for (let axis = 0 as Axis; axis < 3; axis++)
      for (let lo = 0; lo < N; lo++)
        for (let hi = lo; hi < N; hi++) {
          const q1 = movePerm({ axis, lo, hi, q: 1 });
          const q2 = movePerm({ axis, lo, hi, q: 2 });
          const q3 = movePerm({ axis, lo, hi, q: 3 });
          expect(Array.from(composePerm(q1, q1))).toEqual(Array.from(q2));
          expect(Array.from(composePerm(q2, q1))).toEqual(Array.from(q3));
          expect(Array.from(composePerm(q3, q1))).toEqual(Array.from(identityPerm()));
        }
  });

  it('a block turn equals its single layers turned one after another, in any order', () => {
    const start = labelled();
    for (let axis = 0 as Axis; axis < 3; axis++)
      for (let lo = 0; lo < N; lo++)
        for (let hi = lo; hi < N; hi++)
          for (let q = 1; q <= 3; q++) {
            let up = start;
            let down = start;
            for (let l = lo; l <= hi; l++) up = applyMove(up, { axis, lo: l, hi: l, q });
            for (let l = hi; l >= lo; l--) down = applyMove(down, { axis, lo: l, hi: l, q });
            const block = applyMove(start, { axis, lo, hi, q });
            expect(Array.from(up)).toEqual(Array.from(block));
            expect(Array.from(down)).toEqual(Array.from(block));
          }
  });

  it('agrees with the independent reference engine on every move', () => {
    const start = labelled();
    for (const m of everyBlockMove()) {
      const a = applyMove(start, m);
      const b = new RefCube(start).apply(m).toFacelets();
      expect(Array.from(a), moveToString(m)).toEqual(Array.from(b));
    }
  });

  it('agrees with the reference engine on long random sequences', () => {
    const rand = makeRng(12345);
    for (let trial = 0; trial < 50; trial++) {
      const moves = randomMoves(120, rand);
      const a = applyMoves(labelled(), moves);
      const b = new RefCube(labelled()).applyAll(moves).toFacelets();
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });

  it('matches hand-checked facts about R, U and F', () => {
    const s = labelled();
    const afterU = applyMove(s, parseMove('U'));
    for (let c = 0; c < N; c++) {
      // U clockwise: the front top row receives the right face's top row; the left receives the front's.
      expect(afterU[faceletIndex(F, 0, c)]).toBe(faceletIndex(R, 0, c));
      expect(afterU[faceletIndex(L, 0, c)]).toBe(faceletIndex(F, 0, c));
    }
    const afterR = applyMove(s, parseMove('R'));
    for (let r = 0; r < N; r++) {
      // R clockwise: the top face's right column receives the front's right column.
      expect(afterR[faceletIndex(U, r, 5)]).toBe(faceletIndex(F, r, 5));
      // ...and the back's left column (seen from behind) receives the top's right column, upside down.
      expect(afterR[faceletIndex(B, 5 - r, 0)]).toBe(faceletIndex(U, r, 5));
    }
    const afterF = applyMove(s, parseMove('F'));
    for (let i = 0; i < N; i++) {
      // F clockwise: the right face's left column receives the top's bottom row.
      expect(afterF[faceletIndex(R, i, 0)]).toBe(faceletIndex(U, 5, i));
    }
    // A clockwise face turn carries the top-left sticker to the top-right corner.
    expect(afterF[faceletIndex(F, 0, 5)]).toBe(faceletIndex(F, 0, 0));
    // An inner slice leaves both outer faces untouched.
    const after3R = applyMove(s, parseMove('3R'));
    for (let i = 0; i < NN; i++) {
      expect(after3R[R * NN + i]).toBe(R * NN + i);
      expect(after3R[L * NN + i]).toBe(L * NN + i);
    }
    for (let r = 0; r < N; r++) expect(after3R[faceletIndex(U, r, 3)]).toBe(faceletIndex(F, r, 3));
  });

  it('a sequence followed by its inverse restores the cube, and scrambles are not solved', () => {
    const rand = makeRng(7);
    for (let trial = 0; trial < 30; trial++) {
      const moves = randomMoves(80, rand);
      const scrambled = applyMoves(solvedState(), moves);
      expect(isSolved(scrambled)).toBe(false);
      const counts = new Array(6).fill(0);
      for (const c of scrambled) counts[c]++;
      expect(counts).toEqual([36, 36, 36, 36, 36, 36]);
      expect(isSolved(applyMoves(scrambled, invertMoves(moves)))).toBe(true);
    }
  });

  it('turning all six layers together is a whole-cube rotation and keeps a solved cube solved', () => {
    for (let axis = 0 as Axis; axis < 3; axis++)
      for (let q = 1; q <= 3; q++) expect(isSolved(applyMove(solvedState(), { axis, lo: 0, hi: N - 1, q }))).toBe(true);
  });

  it('famous identities hold: (R U R\' U\')x6, and (R2 U2)x6', () => {
    const sexy = parseMoves("R U R' U'");
    let s = solvedState();
    for (let i = 0; i < 6; i++) s = applyMoves(s, sexy);
    expect(isSolved(s)).toBe(true);
    s = solvedState();
    for (let i = 0; i < 6; i++) s = applyMoves(s, parseMoves('Rw2 Uw2'));
    expect(isSolved(s)).toBe(true);
    s = applyMoves(solvedState(), parseMoves("R U R' U'"));
    expect(isSolved(s)).toBe(false);
  });
});

describe('outer layers behave like a 3x3x3 (checked against cubejs)', () => {
  // Reduce a 6x6x6 state to the 54 facelets of a 3x3x3: corners, one wing per edge, one centre per face.
  const pick = [0, 2, 5];
  function reduce(state: Uint8Array): string {
    let out = '';
    for (let f = 0; f < 6; f++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out += 'URFDLB'[state[faceletIndex(f, pick[r] as number, pick[c] as number)] as number];
    return out;
  }
  it('gives the same facelets as cubejs after random outer turns', () => {
    const rand = makeRng(99);
    const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
    const suffix = ['', '2', "'"];
    for (let trial = 0; trial < 40; trial++) {
      const names: string[] = [];
      for (let i = 0; i < 40; i++) names.push((faces[Math.floor(rand() * 6)] as string) + suffix[Math.floor(rand() * 3)]);
      const alg = names.join(' ');
      const mine = reduce(applyMoves(solvedState(), parseMoves(alg)));
      const ref = new Cube();
      ref.move(alg);
      expect(mine).toBe(ref.asString());
    }
  });
});

describe('notation', () => {
  it('names moves in standard big-cube notation', () => {
    const cases: [Move, string][] = [
      [{ axis: 0, lo: 5, hi: 5, q: 1 }, 'R'],
      [{ axis: 0, lo: 4, hi: 5, q: 1 }, 'Rw'],
      [{ axis: 0, lo: 3, hi: 5, q: 3 }, "3Rw'"],
      [{ axis: 0, lo: 4, hi: 4, q: 2 }, '2R2'],
      [{ axis: 0, lo: 3, hi: 3, q: 1 }, '3R'],
      [{ axis: 0, lo: 3, hi: 4, q: 1 }, '2-3Rw'],
      [{ axis: 0, lo: 0, hi: 0, q: 3 }, 'L'],
      [{ axis: 0, lo: 0, hi: 0, q: 1 }, "L'"],
      [{ axis: 0, lo: 0, hi: 1, q: 3 }, 'Lw'],
      [{ axis: 0, lo: 1, hi: 1, q: 3 }, '2L'],
      [{ axis: 0, lo: 1, hi: 2, q: 1 }, "2-3Lw'"],
      [{ axis: 1, lo: 5, hi: 5, q: 1 }, 'U'],
      [{ axis: 1, lo: 0, hi: 2, q: 3 }, '3Dw'],
      [{ axis: 2, lo: 5, hi: 5, q: 2 }, 'F2'],
      [{ axis: 2, lo: 2, hi: 2, q: 1 }, "3B'"],
    ];
    for (const [m, text] of cases) {
      expect(moveToString(m)).toBe(text);
      expect(parseMove(text)).toEqual(m);
    }
  });
  it('round-trips all 108 half-cube block moves', () => {
    const all = allHalfBlockMoves();
    expect(all.length).toBe(108);
    const names = new Set<string>();
    for (const m of all) {
      const text = moveToString(m);
      names.add(text);
      expect(parseMove(text)).toEqual(m);
    }
    expect(names.size).toBe(108);
  });
  it('L and R turn the same way on screen when written with opposite signs', () => {
    // L' is clockwise seen from the right, the same sense as R.
    expect(parseMove("L'").q).toBe(parseMove('R').q);
  });
});

describe('piece tables', () => {
  it('cover all 216 facelets exactly once', () => {
    const seen = new Uint8Array(NF);
    for (const c of CORNERS) for (const f of c.facelets) seen[f]++;
    for (const w of WINGS) for (const f of w.facelets) seen[f]++;
    for (const c of CENTRES) seen[c.facelet]++;
    for (let i = 0; i < NF; i++) expect(seen[i]).toBe(1);
    expect(CORNERS.length).toBe(8);
    expect(WINGS.length).toBe(48);
    expect(CENTRES.length).toBe(96);
  });
  it('has nine facelet orbits of 24', () => {
    const sizes = new Map<number, number>();
    for (let i = 0; i < NF; i++) sizes.set(FACELET_ORBIT[i] as number, (sizes.get(FACELET_ORBIT[i] as number) ?? 0) + 1);
    expect(Array.from(sizes.values())).toEqual(new Array(9).fill(24));
    for (let o = 0; o < 4; o++) expect(CENTRES.filter((c) => c.orbit === o).length).toBe(24);
  });
  it('handed wing facelets stay first or second under every move', () => {
    const first = new Uint8Array(NF);
    for (const w of WINGS) {
      first[w.handed[0]] = 1;
      first[w.handed[1]] = 2;
    }
    for (const m of allHalfBlockMoves()) {
      const p = movePerm(m);
      for (let i = 0; i < NF; i++) expect(first[p[i] as number]).toBe(first[i]);
    }
  });
  it('corner facelets are listed clockwise', () => {
    // A clockwise U turn carries URF to UFL... check that twisting is consistent: the U facelet stays a U facelet.
    const p = movePerm(parseMove('U'));
    const pos = new Map<number, [number, number]>();
    CORNERS.forEach((c, ci) => c.facelets.forEach((f, k) => pos.set(f, [ci, k])));
    for (const c of CORNERS.slice(0, 4)) {
      const from = c.facelets.map((f) => pos.get(p[f] as number) as [number, number]);
      expect(from[0]![1]).toBe(0);
      expect(from[1]![1]).toBe(1);
      expect(from[2]![1]).toBe(2);
    }
    // R turns twist corners: the facelet order must rotate, never reflect.
    const pr = movePerm(parseMove('R'));
    for (const c of CORNERS) {
      const from = c.facelets.map((f) => pos.get(pr[f] as number) as [number, number]);
      const shift = from[0]![1];
      expect(from[1]![1]).toBe((shift + 1) % 3);
      expect(from[2]![1]).toBe((shift + 2) % 3);
      expect(from[1]![0]).toBe(from[0]![0]);
    }
  });
});
