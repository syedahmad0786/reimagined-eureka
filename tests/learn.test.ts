/**
 * The Learn content, checked on the move engine.
 *
 * Every algorithm, variant and setup in src/learn/content.ts is parsed with the app's own parser,
 * replayed, and asserted piece by piece: what it moves and what it leaves alone. Claims in the prose
 * that the engine can decide (which turns are safe, why the parities exist, what the notation means)
 * are checked here too, so a wrong sentence fails a test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { solvedState, isSolved, NF, NN, N, U, R, F, D, L, B, faceletIndex } from '../src/cube/geometry';
import {
  parseMoves,
  parseMove,
  movesToString,
  moveToString,
  applyMoves,
  invertMoves,
  movePerm,
  composePerm,
  identityPerm,
  describeMove,
  allHalfBlockMoves,
  randomMoves,
  makeRng,
  type Move,
} from '../src/cube/moves';
import { CORNERS, EDGES, WINGS, CENTRES, FACELET_ORBIT, CENTRE_INNER_X, CENTRE_OUTER_X, CENTRE_OBLIQUE_A, CENTRE_OBLIQUE_B } from '../src/cube/pieces';
import { deriveScheme, analyseWings, readCorners, standardScheme, type Scheme } from '../src/cube/scheme';
import { validateState } from '../src/cube/validate';
import { randomState } from '../src/cube/random';
import { centresSolved } from '../src/solver/centre-plan';
import { edgesPaired, wingValues } from '../src/solver/edges';
import { analyseReduced, solveReduced, PLL_PARITY_FIX } from '../src/solver/three';
import { movesParity } from '../src/solver/bars';
import { solveCube, prepareSolver, type Phase, type SolveResult } from '../src/solver/index';
import { LEARN_TOPICS, PHASE_NOTES, UI_WORDS, type FaceWord, type LearnAlgorithm, type LearnBlock, type LearnTopic, type LearnVariant, type NotationRow } from '../src/learn/content';
import { learnAlgorithms, findAlgorithm, algorithmDemo } from '../src/learn/demo';

const SOLVED = solvedState();
const FACE_OF_WORD: Record<FaceWord, number> = { top: U, right: R, front: F, bottom: D, left: L, back: B };
const WORD_OF_LETTER: Record<string, FaceWord> = { U: 'top', R: 'right', F: 'front', D: 'bottom', L: 'left', B: 'back' };
const faceOf = (i: number): number => Math.floor(i / NN);
const rowOf = (i: number): number => Math.floor((i % NN) / N);
const colOf = (i: number): number => i % N;
const isOuter = (m: Move): boolean => m.lo === m.hi && (m.lo === 0 || m.lo === N - 1);

/** Pull permutation of a sequence: after[i] = before[p[i]]. */
function permOf(text: string): Uint8Array {
  let p = identityPerm();
  for (const m of parseMoves(text)) p = composePerm(p, movePerm(m));
  return p;
}
const run = (text: string, from: Uint8Array = SOLVED): Uint8Array => applyMoves(from, parseMoves(text));
const inverse = (text: string): string => movesToString(invertMoves(parseMoves(text)));
const samePerm = (a: string, b: string): boolean => Array.from(permOf(a)).join() === Array.from(permOf(b)).join();
const changed = (state: ArrayLike<number>): number[] => Array.from({ length: NF }, (_, i) => i).filter((i) => state[i] !== SOLVED[i]);
const moved = (p: ArrayLike<number>): number[] => Array.from({ length: NF }, (_, i) => i).filter((i) => p[i] !== i);

const WING_OF = new Int16Array(NF).fill(-1);
WINGS.forEach((w, i) => {
  WING_OF[w.facelets[0]] = i;
  WING_OF[w.facelets[1]] = i;
});
const CENTRE_OF = new Int16Array(NF).fill(-1);
CENTRES.forEach((c, i) => {
  CENTRE_OF[c.facelet] = i;
});
const CORNER_FACELETS = new Set(CORNERS.flatMap((c) => c.facelets));
const edgeIndex = (name: string): number => {
  const e = EDGES.findIndex((x) => x.name === name);
  if (e < 0) throw new Error('no edge ' + name);
  return e;
};
/** Wing slot of an edge by its place along the edge, 1..4. */
const wing = (name: string, t: number): number => edgeIndex(name) * 4 + (t - 1);
const wingName = (i: number): string => (EDGES[(WINGS[i] as (typeof WINGS)[number]).edge] as (typeof EDGES)[number]).name + '.' + (WINGS[i] as (typeof WINGS)[number]).t;

/** For every wing slot, the slot its piece came from. */
function wingSources(p: ArrayLike<number>): number[] {
  return WINGS.map((w) => WING_OF[p[w.facelets[0]] as number] as number);
}
/** Wing moves as text, for example "UF.2<-UF.3": the piece now in UF.2 came from UF.3. */
function wingMoves(p: ArrayLike<number>): string[] {
  const src = wingSources(p);
  return src.map((j, i) => (j === i ? '' : wingName(i) + '<-' + wingName(j))).filter(Boolean);
}
/** For every edge: the edge all four of its wings came from and whether they arrived end for end, or null when the group was split. */
function groupSources(p: ArrayLike<number>): ({ from: string; reversed: boolean } | null)[] {
  const src = wingSources(p);
  return EDGES.map((_, e) => {
    const s = [0, 1, 2, 3].map((k) => src[e * 4 + k] as number);
    const from = Math.floor((s[0] as number) / 4);
    if (!s.every((x) => Math.floor(x / 4) === from)) return null;
    const ts = s.map((x) => x % 4);
    const straight = ts.every((t, k) => t === k);
    const reversed = ts.every((t, k) => t === 3 - k);
    if (!straight && !reversed) return null;
    return { from: (EDGES[from] as (typeof EDGES)[number]).name, reversed };
  });
}
/** Centre stickers that end on a different face, as [where it ends, where it came from]. */
function centreCrossings(p: ArrayLike<number>): [number, number][] {
  const out: [number, number][] = [];
  for (const c of CENTRES) if (faceOf(p[c.facelet] as number) !== c.face) out.push([c.facelet, p[c.facelet] as number]);
  return out;
}
const centresStayOnTheirFaces = (p: ArrayLike<number>): boolean => centreCrossings(p).length === 0 && CENTRES.every((c) => CENTRE_OF[p[c.facelet] as number] !== -1);
const cornersFixed = (p: ArrayLike<number>): boolean => [...CORNER_FACELETS].every((i) => p[i] === i);

function cycleSign(map: number[]): number {
  const seen = new Array<boolean>(map.length).fill(false);
  let sign = 0;
  for (let i = 0; i < map.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = map[j] as number) {
      seen[j] = true;
      len++;
    }
    sign ^= (len + 1) & 1;
  }
  return sign;
}
/** 1 when the sequence is an odd permutation of the 24 wings of that kind (0 outer, 1 inner). */
function wingSign(p: ArrayLike<number>, orbit: number): number {
  const src = wingSources(p);
  const slots = WINGS.map((w, i) => (w.orbit === orbit ? i : -1)).filter((i) => i >= 0);
  return cycleSign(slots.map((i) => slots.indexOf(src[i] as number)));
}
const wingsMovedInOrbit = (p: ArrayLike<number>, orbit: number): number => wingSources(p).filter((j, i) => j !== i && (WINGS[i] as (typeof WINGS)[number]).orbit === orbit).length;

const group = (state: ArrayLike<number>, name: string): number[] => Array.from(wingValues(state).slice(edgeIndex(name) * 4, edgeIndex(name) * 4 + 4));
const allSame = (v: number[]): boolean => v.every((x) => x === v[0]);
const flipValue = (v: number): number => (v % 6) * 6 + Math.floor(v / 6);
const brokenEdges = (state: ArrayLike<number>): string[] => EDGES.map((e) => e.name).filter((name) => !allSame(group(state, name)));
const wingColours = (state: ArrayLike<number>, slot: number): string => (WINGS[slot] as (typeof WINGS)[number]).facelets.map((f) => state[f] as number).sort().join('');
const brokenCentreFaces = (state: ArrayLike<number>): number =>
  [0, 1, 2, 3, 4, 5].filter((f) => CENTRES.some((c) => c.face === f && state[c.facelet] !== state[f * NN + 7])).length;

const topic = (id: string): LearnTopic => {
  const t = LEARN_TOPICS.find((x) => x.id === id);
  if (!t) throw new Error('no topic ' + id);
  return t;
};
const alg = (id: string): LearnAlgorithm | LearnVariant => {
  const found = findAlgorithm(id);
  if (!found) throw new Error('no algorithm ' + id);
  return found.item;
};
const everyAlgorithm = (): (LearnAlgorithm | LearnVariant)[] => learnAlgorithms().flatMap((a) => [a, ...(a.variants ?? [])]);
const blocksOf = <K extends LearnBlock['kind']>(t: LearnTopic, kind: K): Extract<LearnBlock, { kind: K }>[] =>
  t.blocks.filter((b): b is Extract<LearnBlock, { kind: K }> => b.kind === kind);

/** Every sentence a person reads, with a label for error messages. */
function prose(): { where: string; text: string; limit: number }[] {
  const out: { where: string; text: string; limit: number }[] = [];
  for (const t of LEARN_TOPICS) {
    out.push({ where: t.id + ' title', text: t.title, limit: 1 }, { where: t.id + ' summary', text: t.summary, limit: 1 });
    t.blocks.forEach((b, k) => {
      const where = t.id + ' block ' + k;
      if (b.kind === 'heading') out.push({ where, text: b.text, limit: 1 });
      else if (b.kind === 'text' || b.kind === 'tip') out.push({ where, text: b.text, limit: 3 });
      else if (b.kind === 'list' || b.kind === 'steps') b.items.forEach((item, j) => out.push({ where: where + ' item ' + j, text: item, limit: 2 }));
      else if (b.kind === 'notation') b.rows.forEach((row) => out.push({ where: where + ' ' + row.notation, text: row.meaning, limit: 2 }));
      else {
        out.push({ where: where + ' name', text: b.name, limit: 1 }, { where: where + ' purpose', text: b.purpose, limit: 2 });
        if (b.note) out.push({ where: where + ' note', text: b.note, limit: 3 });
        for (const v of b.variants ?? []) out.push({ where: where + ' ' + v.id, text: v.label, limit: 1 });
      }
    });
  }
  for (const [phase, note] of Object.entries(PHASE_NOTES)) {
    out.push({ where: phase + ' title', text: note.title, limit: 1 });
    out.push({ where: phase + ' goal', text: note.goal, limit: 2 }, { where: phase + ' watchFor', text: note.watchFor, limit: 2 }, { where: phase + ' tip', text: note.tip, limit: 2 });
  }
  return out;
}
const sentences = (text: string): number => (text.match(/[.!?](?=\s|$)/g) ?? []).length;

describe('learn content: shape and wording', () => {
  it('has the eight topics in the agreed order', () => {
    expect(LEARN_TOPICS.map((t) => t.id)).toEqual(['reduction', 'notation', 'centres', 'edges', 'parity', 'three', 'handling', 'recovery']);
    for (const t of LEARN_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.summary.length).toBeGreaterThan(0);
      expect(t.blocks.length).toBeGreaterThan(3);
    }
  });

  it('has a note for each phase of the guided solve and no other', () => {
    const phases: Phase[] = ['centres', 'edges', 'parity', '3x3'];
    const notes: Record<Phase, { title: string; goal: string; watchFor: string; tip: string }> = PHASE_NOTES;
    expect(Object.keys(notes).sort()).toEqual([...phases].sort());
    for (const p of phases) for (const field of ['title', 'goal', 'watchFor', 'tip'] as const) expect(notes[p][field].length).toBeGreaterThan(10 - (field === 'title' ? 5 : 0));
  });

  it('gives every algorithm and variant a unique id that the lookup finds', () => {
    const ids = everyAlgorithm().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    for (const id of ids) expect(findAlgorithm(id)?.item.id).toBe(id);
    expect(findAlgorithm('nothing')).toBeNull();
  });

  it('writes every moves, setup and sameAs string exactly as the app prints it', () => {
    for (const a of everyAlgorithm()) {
      for (const text of [a.moves, a.setup, a.sameAs]) {
        if (text === undefined) continue;
        const parsed = parseMoves(text);
        expect(parsed.length, a.id).toBeGreaterThan(0);
        expect(movesToString(parsed), a.id).toBe(text);
        expect(parsed.map(moveToString).join(' '), a.id).toBe(text);
        for (const m of parsed) expect(describeMove(m).toLayer, a.id + ' never counts past layer 3').toBeLessThanOrEqual(3);
      }
    }
  });

  it('every setup shows a case and its algorithm solves it', () => {
    let withSetup = 0;
    for (const a of everyAlgorithm()) {
      if (!a.setup) continue;
      withSetup++;
      const demo = algorithmDemo(a);
      expect(isSolved(demo.start), a.id + ' setup is not solved').toBe(false);
      expect(demo.states.length, a.id).toBe(demo.moves.length + 1);
      expect(isSolved(demo.states[demo.states.length - 1] as Uint8Array), a.id + ' ends solved').toBe(true);
      for (let k = 1; k < demo.states.length - 1; k++) expect(isSolved(demo.states[k] as Uint8Array), a.id + ' is not solved early').toBe(false);
    }
    expect(withSetup).toBeGreaterThanOrEqual(17);
  });

  it('names in the notes the variants that the tests prove', () => {
    const note = (id: string): string => (alg(id) as LearnAlgorithm).note ?? '';
    expect(note('centre-exchange')).toContain(alg('centre-exchange-3l').moves);
    expect(note('centre-exchange')).toContain(alg('centre-exchange-2l').moves);
    expect(note('centre-exchange')).toContain('2R in place of 3R');
    expect(alg('centre-exchange-2r').moves).toBe(alg('centre-exchange').moves.replace(/3R/g, '2R'));
    for (const id of ['edge-slice-replace-2u', 'edge-slice-replace-3d', 'edge-slice-replace-2d']) {
      const tokens = alg(id).moves.split(' ');
      expect(note('edge-slice-replace')).toContain(tokens[0] as string);
      expect(note('edge-slice-replace')).toContain(tokens[tokens.length - 1] as string);
      expect(tokens.slice(1, -1).join(' ')).toBe("R U R'");
    }
    for (const id of ['last-two-edges-outer', 'last-two-edges-both']) {
      const tokens = alg(id).moves.split(' ');
      expect(note('last-two-edges')).toContain(tokens[0] as string);
      expect(note('last-two-edges')).toContain(tokens[tokens.length - 1] as string);
      expect(tokens.slice(1, -1).join(' ')).toBe(alg('edge-flip').moves);
    }
    expect(note('flip-parity-inner')).toContain('layer 2 in place of layer 3');
    expect(alg('flip-parity-outer').moves).toBe(alg('flip-parity-inner').moves.replace(/3([RL])/g, '2$1'));
    expect(alg('flip-parity-whole').moves).toBe(alg('flip-parity-inner').moves.replace(/3([RL])/g, '2-3$1w'));
    expect(parseMoves(alg('flip-parity-inner').moves).length).toBe(15);
    expect(note('flip-parity-inner')).toContain('Fifteen turns');
    expect(parseMoves(alg('swap-parity').moves).length).toBe(6);
    expect(note('swap-parity')).toContain('Six half turns');
    expect(parseMoves(alg('centre-three-cycle').moves).length).toBe(8);
    expect(note('centre-three-cycle')).toContain('Eight moves');
  });

  it('keeps every piece of text short, in sentence case and in British spelling', () => {
    for (const p of prose()) {
      expect(p.text.trim(), p.where).toBe(p.text);
      expect(p.text.length, p.where).toBeGreaterThan(0);
      expect(sentences(p.text), p.where + ': "' + p.text + '"').toBeLessThanOrEqual(p.limit);
      expect(p.text, p.where).not.toMatch(/\b(color|center|centered|gray|counterclockwise|counter-clockwise|favorite|neighbor)/i);
      expect(p.text, p.where).not.toMatch(/\u2014|\u2013/);
      expect(p.text, p.where).not.toMatch(/\b[xyz]'?\b(?!\d)/);
    }
    const headings = prose().filter((p) => /title|name$/.test(p.where) || p.limit === 1);
    for (const h of headings) {
      const words = h.text.split(/\s+/).slice(1);
      for (const w of words) expect(/^[A-Z][a-z]{2,}/.test(w), h.where + ': "' + h.text + '" is not sentence case').toBe(false);
    }
    expect(UI_WORDS.back).toBe('Back');
    const recovery = topic('recovery').blocks.flatMap((b) => (b.kind === 'steps' ? b.items : []));
    expect(recovery.some((s) => s.includes(UI_WORDS.back))).toBe(true);
    expect(recovery.some((s) => s.includes(UI_WORDS.showTurn))).toBe(true);
  });
});

describe('topic 1, the idea of reduction', () => {
  it('counts the pieces as the piece tables do', () => {
    expect(CORNERS.length).toBe(8);
    expect(WINGS.length).toBe(48);
    expect(EDGES.length).toBe(12);
    expect(CENTRES.length).toBe(96);
    expect(CORNERS.length * 3 + WINGS.length * 2 + CENTRES.length).toBe(NF);
    const list = blocksOf(topic('reduction'), 'list')[0]?.items ?? [];
    expect(list[0]).toMatch(/^8 corner pieces/);
    expect(list[1]).toMatch(/^48 edge pieces.*four on each of the 12 edges/);
    expect(list[2]).toMatch(/^96 centre pieces: sixteen on each of the 6 sides/);
  });

  it('a turn of one outer face never splits a centre block or an edge group', () => {
    const outer = allHalfBlockMoves().filter(isOuter);
    expect(outer.length).toBe(18);
    for (const m of outer) {
      const p = movePerm(m);
      expect(centresStayOnTheirFaces(p), moveToString(m)).toBe(true);
      expect(groupSources(p).every((g) => g !== null), moveToString(m)).toBe(true);
    }
    const rand = makeRng(11);
    for (let t = 0; t < 50; t++) {
      let s = SOLVED;
      for (let k = 0; k < 40; k++) s = applyMoves(s, [outer[Math.floor(rand() * outer.length)] as Move]);
      expect(centresSolved(s)).toBe(true);
      expect(edgesPaired(s)).toBe(true);
    }
  });

  it('every turn that includes an inner layer splits both', () => {
    const inner = allHalfBlockMoves().filter((m) => !isOuter(m));
    expect(inner.length).toBe(90);
    for (const m of inner) {
      const s = applyMoves(SOLVED, [m]);
      expect(centresSolved(s), moveToString(m)).toBe(false);
      expect(edgesPaired(s), moveToString(m)).toBe(false);
    }
    const unsafe = blocksOf(topic('three'), 'list')[0]?.items[1] ?? '';
    for (const example of ['2R', 'Rw', '3Uw2']) {
      expect(unsafe).toContain(example);
      expect(centresSolved(run(example))).toBe(false);
      expect(edgesPaired(run(example))).toBe(false);
    }
  });
});

describe('topic 2, the notation', () => {
  const rows: NotationRow[] = blocksOf(topic('notation'), 'notation').flatMap((b) => b.rows);
  const count = (n: number): string => (n === 2 ? 'two' : 'three');

  function meaningOf(text: string): string {
    const d = describeMove(parseMove(text));
    const face = WORD_OF_LETTER[d.face] as FaceWord;
    let what: string;
    if (d.fromLayer === 1 && d.toLayer === 1) what = 'The ' + face + ' face, outer layer only.';
    else if (d.fromLayer === 1) what = 'The ' + count(d.toLayer) + ' outer layers on the ' + face + ', together.';
    else if (d.fromLayer === d.toLayer) what = 'Only layer ' + d.fromLayer + ' counted from the ' + face + '.';
    else what = 'Layers ' + d.fromLayer + ' to ' + d.toLayer + ' counted from the ' + face + ', together.';
    const how = d.clockwise === 2 ? 'Half turn.' : 'Quarter turn ' + (d.clockwise === 1 ? 'clockwise' : 'anticlockwise') + ', looking at the ' + face + ' face.';
    return what + ' ' + how;
  }

  it('every example means what its text and its fields say', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const row of rows) {
      const m = parseMove(row.notation);
      expect(moveToString(m), row.notation).toBe(row.notation);
      const d = describeMove(m);
      expect(WORD_OF_LETTER[d.face], row.notation).toBe(row.face);
      expect([d.fromLayer, d.toLayer], row.notation).toEqual(row.layers);
      expect(d.clockwise === 1 ? 'clockwise' : d.clockwise === 2 ? 'half' : 'anticlockwise', row.notation).toBe(row.turn);
      if (!row.carries) expect(row.meaning, row.notation).toBe(meaningOf(row.notation));
    }
  });

  it('shows every form, every face and every kind of turn', () => {
    const plain = rows.filter((r) => !r.carries).map((r) => r.notation);
    for (const form of ['R', "R'", 'R2', 'Rw', '3Rw', '2R', '3R', '2-3Rw']) expect(plain).toContain(form);
    expect(new Set(rows.map((r) => r.face)).size).toBe(6);
    expect(new Set(rows.map((r) => r.turn)).size).toBe(3);
    const shapes = new Set(rows.filter((r) => r.face !== 'right').map((r) => r.layers.join('-')));
    expect([...shapes].sort()).toEqual(['1-1', '1-2', '1-3', '2-2', '2-3', '3-3']);
  });

  it('a clockwise turn carries the stickers the way the text says', () => {
    const directions = rows.filter((r) => r.carries);
    expect(directions.filter((r) => r.layers[0] === 1 && r.layers[1] === 1).map((r) => r.face).sort()).toEqual(['back', 'bottom', 'front', 'left', 'right', 'top']);
    for (const row of directions) {
      const carries = row.carries as { from: FaceWord; to: FaceWord };
      const p = movePerm(parseMove(row.notation));
      const arriving = moved(p).filter((i) => faceOf(i) === FACE_OF_WORD[carries.to] && faceOf(p[i] as number) !== faceOf(i));
      expect(arriving.length, row.notation).toBe(N * (row.layers[1] - row.layers[0] + 1));
      for (const i of arriving) expect(faceOf(p[i] as number), row.notation).toBe(FACE_OF_WORD[carries.from]);
      expect(row.meaning, row.notation).toContain('the ' + carries.from + ' stickers of');
      expect(row.meaning, row.notation).toContain('move to the ' + carries.to + '.');
      expect(row.turn).toBe('clockwise');
    }
    const left = directions.find((r) => r.notation === 'L')?.carries;
    const right = directions.find((r) => r.notation === 'R')?.carries;
    expect([left?.from, left?.to, right?.from, right?.to]).toEqual(['front', 'bottom', 'front', 'top']);
  });

  it('never counts past layer 3: a layer nearer the other side is named from that side', () => {
    for (const m of allHalfBlockMoves()) expect(describeMove(m).toLayer).toBeLessThanOrEqual(3);
    expect(moveToString(parseMove('4R'))).toBe("3L'");
    expect(describeMove(parseMove('4R'))).toMatchObject({ face: 'L', fromLayer: 3, toLayer: 3 });
  });
});

describe('topic 3, centres', () => {
  it('a block has four kinds of place, four of each, and a piece keeps its kind and can reach every side', () => {
    for (const orbit of [CENTRE_INNER_X, CENTRE_OUTER_X, CENTRE_OBLIQUE_A, CENTRE_OBLIQUE_B]) {
      const slots = CENTRES.filter((c) => c.orbit === orbit);
      expect(slots.length).toBe(24);
      for (let f = 0; f < 6; f++) expect(slots.filter((c) => c.face === f).length).toBe(4);
      expect(new Set(slots.map((c) => FACELET_ORBIT[c.facelet])).size).toBe(1);
    }
    expect(new Set(CENTRES.map((c) => FACELET_ORBIT[c.facelet])).size).toBe(4);
    const middle = CENTRES.filter((c) => c.orbit === CENTRE_INNER_X);
    expect(middle.every((c) => (c.row === 2 || c.row === 3) && (c.col === 2 || c.col === 3))).toBe(true);
    const blockCorners = CENTRES.filter((c) => c.orbit === CENTRE_OUTER_X);
    expect(blockCorners.every((c) => (c.row === 1 || c.row === 4) && (c.col === 1 || c.col === 4))).toBe(true);
    for (const m of allHalfBlockMoves()) {
      const p = movePerm(m);
      for (const c of CENTRES) expect((CENTRES[CENTRE_OF[p[c.facelet] as number] as number] as (typeof CENTRES)[number]).orbit).toBe(c.orbit);
    }
  });

  it('the opposite colour is the one that never shares a corner piece', () => {
    const rand = makeRng(5);
    for (let t = 0; t < 30; t++) {
      const colours = [0, 1, 2, 3, 4, 5].sort(() => rand() - 0.5);
      const state = randomState(rand, colours);
      const scheme = deriveScheme(state).scheme as Scheme;
      const corners = readCorners(state);
      for (let c = 0; c < 6; c++) {
        const together = new Set(corners.filter((k) => k.includes(c)).flat());
        const never = [0, 1, 2, 3, 4, 5].filter((x) => !together.has(x));
        expect(never).toEqual([scheme.opposite[c]]);
      }
    }
  });

  it('centres must go round each corner in the order of that corner piece, or most corners fit nowhere', () => {
    const canon = (t: readonly number[]): string => {
      const k = t.indexOf(Math.min(...t));
      return [t[k], t[(k + 1) % 3], t[(k + 2) % 3]].join('');
    };
    const centreColour = (state: ArrayLike<number>, f: number): number => state[f * NN + 7] as number;
    const around = (state: ArrayLike<number>): string[] => CORNERS.map((c) => canon(c.faces.map((f) => centreColour(state, f))));
    const pieces = (state: ArrayLike<number>): string[] => readCorners(state).map(canon);
    expect(around(SOLVED)).toEqual(pieces(SOLVED));
    const homeless = (a: number, b: number): number => {
      const swapped = solvedState();
      for (const c of CENTRES) {
        if (c.face === a) swapped[c.facelet] = b;
        if (c.face === b) swapped[c.facelet] = a;
      }
      expect(centresSolved(swapped)).toBe(true);
      const have = new Set(pieces(swapped));
      return around(swapped).filter((slot) => !have.has(slot)).length;
    };
    expect(homeless(F, R)).toBe(6);
    expect(homeless(U, D)).toBe(8);
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) expect(homeless(a, b)).toBeGreaterThanOrEqual(6);
    expect(blocksOf(topic('centres'), 'text').some((b) => b.text.includes('most corners no longer fit anywhere'))).toBe(true);
  });

  it('with two finished centres on the left and right, the turns the text allows cannot touch them', () => {
    const allowed = ['2R', '3R', '2L', '3L', 'U', 'F', 'D', 'B'].flatMap((m) => [m, m + "'", m + '2']);
    for (const text of allowed) {
      const p = permOf(text);
      for (const c of CENTRES) if (c.face === L || c.face === R) expect(p[c.facelet], text).toBe(c.facelet);
    }
  });

  const exchangeCases: [string, number[], number[]][] = [
    ['centre-exchange', [3], [2]],
    ['centre-exchange-2r', [4], [1]],
    ['centre-exchange-3l', [2], [3]],
    ['centre-exchange-2l', [1], [4]],
    ['centre-exchange-two', [3, 4], [2, 1]],
  ];
  for (const [id, frontCols, topCols] of exchangeCases) {
    it('the exchange ' + id + ' swaps exactly those bars and leaves the other four centres as they were', () => {
      const a = alg(id);
      const p = permOf(a.moves);
      expect(parseMoves(a.moves).length).toBe(3);
      const crossings = centreCrossings(p);
      expect(crossings.length).toBe(8 * frontCols.length);
      const want = new Set<number>();
      for (let r = 1; r <= 4; r++) {
        for (const c of frontCols) want.add(faceletIndex(F, r, c));
        for (const c of topCols) want.add(faceletIndex(U, r, c));
      }
      expect(new Set(crossings.map(([dest]) => dest))).toEqual(want);
      for (const [dest, src] of crossings) {
        expect(faceOf(src)).toBe(faceOf(dest) === F ? U : F);
        expect(colOf(src)).toBe(N - 1 - colOf(dest));
        expect(rowOf(src)).toBe(N - 1 - rowOf(dest));
      }
      for (const c of CENTRES) if (c.face !== F && c.face !== U) expect(p[c.facelet]).toBe(c.facelet);
      expect(moved(composePerm(p, p)).length).toBe(0);
      expect(a.setup).toBe(a.moves);
      const s = run(a.setup as string);
      expect(brokenCentreFaces(s)).toBe(2);
      for (const c of frontCols) for (let r = 1; r <= 4; r++) expect(s[faceletIndex(F, r, c)]).toBe(U);
      for (const c of topCols) for (let r = 1; r <= 4; r++) expect(s[faceletIndex(U, r, c)]).toBe(F);
    });
  }

  it('the bar in layer 3 from the right lands in layer 3 from the left, as the note says', () => {
    const p = permOf(alg('centre-exchange').moves);
    const up = centreCrossings(p).filter(([dest]) => faceOf(dest) === U);
    for (const [dest, src] of up) {
      expect(N - colOf(src)).toBe(3);
      expect(colOf(dest) + 1).toBe(3);
    }
    expect((alg('centre-exchange') as LearnAlgorithm).note).toContain('layer 3 from the right lands in layer 3 from the left');
  });

  it('the exchange disturbs edges and corners, and leaving out its last move leaves four centres broken', () => {
    const a = alg('centre-exchange');
    expect(edgesPaired(run(a.moves))).toBe(false);
    expect(cornersFixed(permOf(a.moves))).toBe(false);
    const withoutLast = a.moves.split(' ').slice(0, -1).join(' ');
    expect(brokenCentreFaces(run(withoutLast))).toBe(4);
  });

  const cycleCases: [string, number][] = [
    ['centre-three-cycle', CENTRE_INNER_X],
    ['centre-three-cycle-corner', CENTRE_OUTER_X],
    ['centre-three-cycle-side-a', -1],
    ['centre-three-cycle-side-b', -1],
  ];
  for (const [id, orbit] of cycleCases) {
    it('the trick ' + id + ' moves three centre pieces of one kind and nothing else at all', () => {
      const a = alg(id);
      const p = permOf(a.moves);
      const m = moved(p);
      expect(m.length).toBe(3);
      const slots = m.map((i) => CENTRES[CENTRE_OF[i] as number] as (typeof CENTRES)[number]);
      expect(slots.every((c) => c !== undefined)).toBe(true);
      expect(new Set(slots.map((c) => c.orbit)).size).toBe(1);
      if (orbit >= 0) expect(slots[0]?.orbit).toBe(orbit);
      else expect([CENTRE_OBLIQUE_A, CENTRE_OBLIQUE_B]).toContain(slots[0]?.orbit);
      expect(slots.map((c) => c.face).sort()).toEqual([U, F, F].sort());
      const top = m.find((i) => faceOf(i) === U) as number;
      expect(faceOf(p[top] as number)).toBe(F);
      const down = m.find((i) => faceOf(i) === F && faceOf(p[i] as number) === U) as number;
      const sideways = m.find((i) => faceOf(i) === F && faceOf(p[i] as number) === F) as number;
      expect(down).toBeDefined();
      expect(sideways).toBeDefined();
      expect(a.setup).toBe(inverse(a.moves));
      const s = run(a.setup as string);
      expect(changed(s).length).toBe(2);
      expect(changed(s).map(faceOf).sort()).toEqual([U, F].sort());
      expect(edgesPaired(s)).toBe(true);
    });
  }

  it('the four tricks reach the four kinds of place between them', () => {
    const kinds = cycleCases.map(([id]) => (CENTRES[CENTRE_OF[moved(permOf(alg(id).moves))[0] as number] as number] as (typeof CENTRES)[number]).orbit);
    expect(new Set(kinds).size).toBe(4);
    const main = permOf(alg('centre-three-cycle').moves);
    const sideways = moved(main).find((i) => faceOf(i) === F && faceOf(main[i] as number) === F) as number;
    expect(rowOf(main[sideways] as number)).toBe(rowOf(sideways));
  });
});

describe('topic 4, edge pairing', () => {
  it('there are 24 outer and 24 inner wings, and no turn moves one kind into the other kind of place', () => {
    expect(WINGS.filter((w) => w.orbit === 0).length).toBe(24);
    expect(WINGS.filter((w) => w.orbit === 1).length).toBe(24);
    expect(WINGS.filter((w) => w.orbit === 0).every((w) => w.t === 1 || w.t === 4)).toBe(true);
    for (const m of allHalfBlockMoves()) {
      const src = wingSources(movePerm(m));
      src.forEach((j, i) => expect((WINGS[j] as (typeof WINGS)[number]).orbit).toBe((WINGS[i] as (typeof WINGS)[number]).orbit));
    }
  });

  it('a wing fits each place only one way round', () => {
    const first = new Set(WINGS.map((w) => w.handed[0]));
    for (const m of allHalfBlockMoves()) {
      const p = movePerm(m);
      for (const w of WINGS) expect(first.has(p[w.handed[0]] as number)).toBe(true);
    }
    const rand = makeRng(3);
    for (let t = 0; t < 40; t++) {
      let p = identityPerm();
      for (const m of randomMoves(60, rand)) p = composePerm(p, movePerm(m));
      wingSources(p).forEach((j, i) => {
        if (j === i) expect(p[(WINGS[i] as (typeof WINGS)[number]).facelets[0]]).toBe((WINGS[i] as (typeof WINGS)[number]).facelets[0]);
      });
    }
  });

  const sliceCases: [string, number][] = [
    ['edge-slice-replace', 3],
    ['edge-slice-replace-2u', 4],
    ['edge-slice-replace-3d', 2],
    ['edge-slice-replace-2d', 1],
  ];
  for (const [id, t] of sliceCases) {
    it(id + ': the slice joins the wing, the replace stores the group, the slice back mends the centres', () => {
      const a = alg(id);
      const tokens = a.moves.split(' ');
      expect(a.setup).toBe(inverse(a.moves));
      const s0 = run(a.setup as string);
      expect(centresSolved(s0)).toBe(true);
      expect(brokenEdges(s0)).toEqual(['UB', 'FR', 'BR']);
      const before = group(s0, 'FR');
      const others = before.filter((_, k) => k !== t - 1);
      expect(allSame(others)).toBe(true);
      expect(before[t - 1]).not.toBe(others[0]);

      const slice = movePerm(parseMove(tokens[0] as string));
      expect(wingSources(slice)[wing('FR', t)]).toBe(wing('BR', t));
      expect(describeMove(parseMove(tokens[0] as string)).fromLayer).toBe(describeMove(parseMove(tokens[0] as string)).toLayer);
      const s1 = run(tokens[0] as string, s0);
      expect(allSame(group(s1, 'FR'))).toBe(true);
      expect(centresSolved(s1)).toBe(false);

      const replace = groupSources(permOf(tokens.slice(1, 4).join(' ')));
      expect(replace[edgeIndex('UF')]).toEqual({ from: 'FR', reversed: false });
      expect(replace[edgeIndex('FR')]).toEqual({ from: 'UB', reversed: true });
      const s4 = run(tokens.slice(1, 4).join(' '), s1);
      expect(allSame(group(s4, 'UF'))).toBe(true);
      expect(group(s4, 'UF')[0]).toBe(SOLVED[faceletIndex(U, 5, 2)]! * 6 + SOLVED[faceletIndex(F, 0, 2)]!);
      expect(centresSolved(s4)).toBe(false);

      const s5 = run(tokens[4] as string, s4);
      expect(isSolved(s5)).toBe(true);

      const p = permOf(a.moves);
      expect(centresStayOnTheirFaces(p)).toBe(true);
      expect(wingSign(p, 0)).toBe(0);
      expect(wingSign(p, 1)).toBe(0);
    });
  }

  it('a replacing move must turn each side face back, as the tip says', () => {
    expect(centresSolved(run("3U R U R' 3U'"))).toBe(true);
    expect(centresSolved(run("3U R U 3U'"))).toBe(false);
    expect(centresSolved(run("3U R U R2 3U'"))).toBe(false);
    expect(centresSolved(run("3U' R U R' F R' F' R 3U"))).toBe(true);
  });

  it('edge-flip turns the front-right edge over in place and splits nothing', () => {
    const a = alg('edge-flip');
    expect(parseMoves(a.moves).every(isOuter)).toBe(true);
    const p = permOf(a.moves);
    const groups = groupSources(p);
    expect(groups.every((g) => g !== null)).toBe(true);
    expect(groups[edgeIndex('FR')]).toEqual({ from: 'FR', reversed: true });
    const movedGroups = EDGES.map((e, k) => (groups[k]?.from === e.name ? '' : e.name + '<-' + groups[k]?.from)).filter(Boolean);
    expect(movedGroups).toEqual(['UR<-UB', 'UF<-UR', 'UL<-UF', 'UB<-UL']);
    expect(centresStayOnTheirFaces(p)).toBe(true);
    expect(cornersFixed(p)).toBe(false);
    const s = run(a.moves);
    expect(centresSolved(s)).toBe(true);
    expect(edgesPaired(s)).toBe(true);
    expect(group(s, 'FR')).toEqual(group(SOLVED, 'FR').map(flipValue));
    expect(a.setup).toBe(inverse(a.moves));
  });

  const lastTwo: [string, number[], number[]][] = [
    ['last-two-edges', [3], [2]],
    ['last-two-edges-outer', [4], [1]],
    ['last-two-edges-both', [3, 4], [2, 1]],
  ];
  for (const [id, leftSlots, rightSlots] of lastTwo) {
    it(id + ' trades those wings between front-left and front-right and pairs both edges', () => {
      const a = alg(id);
      const tokens = a.moves.split(' ');
      expect(a.setup).toBe(inverse(a.moves));
      const s0 = run(a.setup as string);
      expect(centresSolved(s0)).toBe(true);
      expect(brokenEdges(s0)).toEqual(['FR', 'FL']);

      const frontLeft = wingColours(SOLVED, wing('FL', 1));
      const frontRight = wingColours(SOLVED, wing('FR', 1));
      for (let t = 1; t <= 4; t++) {
        expect(wingColours(s0, wing('FL', t)), 'FL.' + t).toBe(leftSlots.includes(t) ? frontRight : frontLeft);
        expect(wingColours(s0, wing('FR', t)), 'FR.' + t).toBe(rightSlots.includes(t) ? frontLeft : frontRight);
      }
      expect(rightSlots).toEqual(leftSlots.map((t) => 5 - t));

      const p = permOf(a.moves);
      const trades = wingMoves(p).filter((x) => x.startsWith('FL') || /FR\.\d<-FL/.test(x));
      expect(trades.sort()).toEqual([...leftSlots.map((t) => 'FL.' + t + '<-FR.' + (5 - t)), ...leftSlots.map((t) => 'FR.' + (5 - t) + '<-FL.' + t)].sort());
      const groups = groupSources(p);
      EDGES.forEach((e, k) => {
        if (e.name !== 'FR' && e.name !== 'FL') expect(groups[k], e.name).not.toBeNull();
      });
      expect(centresStayOnTheirFaces(p)).toBe(true);
      expect(wingSign(p, 0)).toBe(0);
      expect(wingSign(p, 1)).toBe(0);
      expect(isSolved(run(a.moves, s0))).toBe(true);

      if (leftSlots.length === 1) {
        const t = leftSlots[0] as number;
        const slid = group(run(tokens[0] as string, s0), 'FR');
        const partners = slid.filter((_, k) => k !== 4 - t);
        expect(allSame(partners), 'after the slide the wing matches').toBe(true);
        const kind = (k: number): number => (k === 0 || k === 3 ? 0 : 1);
        const before = group(s0, 'FR');
        const otherKind = [0, 1, 2, 3].filter((k) => kind(k) !== kind(t - 1));
        expect(before[otherKind[0] as number]).toBe(before[otherKind[1] as number]);
        expect(slid[t - 1]).toBe(before[otherKind[0] as number]);
      }
    });
  }

  it('when neither condition holds, turning the front-right edge over first makes the algorithm fit', () => {
    const flip = alg('edge-flip').moves;
    const last = alg('last-two-edges').moves;
    const s0 = run(inverse(flip + ' ' + last));
    expect(centresSolved(s0)).toBe(true);
    expect(brokenEdges(s0)).toEqual(['FR', 'FL']);
    const frontLeft = wingColours(SOLVED, wing('FL', 1));
    const frontRight = wingColours(SOLVED, wing('FR', 1));
    expect(wingColours(s0, wing('FL', 3))).toBe(frontRight);
    expect(wingColours(s0, wing('FR', 3))).toBe(frontLeft);
    expect(wingColours(s0, wing('FR', 2))).toBe(frontRight);
    const slid = group(run(last.split(' ')[0] as string, s0), 'FR');
    expect(slid[2]).not.toBe(slid[0]);
    expect(edgesPaired(run(last, s0))).toBe(false);
    expect(isSolved(run(flip + ' ' + last, s0))).toBe(true);
  });

  it('when only one condition holds it is the first parity: swapping the right edge\'s inner wings makes the algorithm fit', () => {
    const last = alg('last-two-edges').moves;
    const swapOnRight = "F' " + alg('flip-parity-inner').moves + ' F';
    expect(groupSources(permOf("F'"))[edgeIndex('UF')]?.from).toBe('FR');
    expect(wingMoves(permOf(swapOnRight)).sort()).toEqual(['FR.2<-FR.3', 'FR.3<-FR.2']);
    const frontLeft = wingColours(SOLVED, wing('FL', 1));
    const frontRight = wingColours(SOLVED, wing('FR', 1));
    const slideMatches = (s: Uint8Array): boolean => {
      const slid = group(run(last.split(' ')[0] as string, s), 'FR');
      return slid[2] === slid[0] && slid[2] === slid[3];
    };
    const mirrorHeight = (s: Uint8Array): boolean => wingColours(s, wing('FL', 3)) === frontRight && wingColours(s, wing('FR', 2)) === frontLeft;
    const both = run(inverse(last));
    expect([slideMatches(both), mirrorHeight(both)]).toEqual([true, true]);

    const slideOnly = run(swapOnRight, both);
    expect(brokenEdges(slideOnly)).toEqual(['FR', 'FL']);
    expect([slideMatches(slideOnly), mirrorHeight(slideOnly)]).toEqual([true, false]);
    expect(wingColours(slideOnly, wing('FR', 3))).toBe(frontLeft);
    expect(edgesPaired(run(last, slideOnly))).toBe(false);
    expect(wingSign(permOf(swapOnRight), 1)).toBe(1);
    expect(isSolved(run(swapOnRight + ' ' + last, slideOnly))).toBe(true);

    const flip = alg('edge-flip').moves;
    const mirrorOnly = run(inverse(flip), slideOnly);
    expect(brokenEdges(mirrorOnly)).toEqual(['FR', 'FL']);
    expect([slideMatches(mirrorOnly), mirrorHeight(mirrorOnly)]).toEqual([false, true]);
    expect(edgesPaired(run(last, mirrorOnly))).toBe(false);
    const neither = run(swapOnRight, mirrorOnly);
    expect([slideMatches(neither), mirrorHeight(neither)]).toEqual([false, false]);
    expect(isSolved(run(flip + ' ' + last, neither))).toBe(true);
    const steps = blocksOf(topic('edges'), 'steps')[1]?.items ?? [];
    expect(steps.some((s) => s.includes("with F'") && s.includes('with F '))).toBe(true);
  });

  it('the app keeps layers turned away during pairing, as the text says, because slices alone break centres', () => {
    expect(centresSolved(run('3U'))).toBe(false);
    expect(centresSolved(run("3U R U R'"))).toBe(false);
  });
});

describe('topic 5, the two parities', () => {
  it('a quarter turn of an inner layer is one ring of four wings of one kind: an odd change', () => {
    for (let axis = 0; axis < 3; axis++) {
      for (const layer of [1, 2, 3, 4]) {
        for (const q of [1, 3]) {
          const p = movePerm({ axis: axis as 0 | 1 | 2, lo: layer, hi: layer, q });
          const mine = layer === 1 || layer === 4 ? 0 : 1;
          expect(wingsMovedInOrbit(p, mine)).toBe(4);
          expect(wingsMovedInOrbit(p, 1 - mine)).toBe(0);
          expect(wingSign(p, mine)).toBe(1);
          const src = wingSources(p);
          const start = src.findIndex((j, i) => j !== i);
          let len = 0;
          for (let j = start; len === 0 || j !== start; j = src[j] as number) len++;
          expect(len).toBe(4);
        }
      }
    }
  });

  it('outer turns and every pairing move make an even number of swaps of each kind of wing', () => {
    for (const m of allHalfBlockMoves().filter(isOuter)) {
      const p = movePerm(m);
      expect(wingSign(p, 0)).toBe(0);
      expect(wingSign(p, 1)).toBe(0);
    }
    for (const a of blocksOf(topic('edges'), 'algorithm').flatMap((b) => [b, ...(b.variants ?? [])])) {
      const p = permOf(a.moves);
      expect(wingSign(p, 0), a.id).toBe(0);
      expect(wingSign(p, 1), a.id).toBe(0);
      expect(movesParity(parseMoves(a.moves)), a.id).toBe(0);
    }
  });

  it('a scramble leaves a kind of wing odd exactly when its inner layers made an odd number of quarter turns', () => {
    const rand = makeRng(21);
    const scheme = standardScheme();
    const seen = new Set<number>();
    for (let t = 0; t < 80; t++) {
      const scramble = randomMoves(40 + (t % 3), rand);
      const report = analyseWings(applyMoves(SOLVED, scramble), scheme);
      expect(report.valid).toBe(true);
      const want = movesParity(scramble);
      expect((report.odd[0] ? 1 : 0) | (report.odd[1] ? 2 : 0)).toBe(want);
      seen.add(want);
    }
    expect(seen.size).toBe(4);
  });

  const flipCases: [string, number[], number][] = [
    ['flip-parity-inner', [2, 3], 1],
    ['flip-parity-outer', [1, 4], 0],
  ];
  for (const [id, slots, orbit] of flipCases) {
    it(id + ' swaps exactly those two wings of the top-front edge and nothing else that shows', () => {
      const a = alg(id);
      const p = permOf(a.moves);
      expect(wingMoves(p).sort()).toEqual(['UF.' + slots[0] + '<-UF.' + slots[1], 'UF.' + slots[1] + '<-UF.' + slots[0]].sort());
      expect(cornersFixed(p)).toBe(true);
      expect(centresStayOnTheirFaces(p)).toBe(true);
      for (const w of WINGS) {
        if (wingName(WINGS.indexOf(w)).startsWith('UF.') && slots.includes(w.t)) continue;
        expect(p[w.facelets[0]]).toBe(w.facelets[0]);
        expect(p[w.facelets[1]]).toBe(w.facelets[1]);
      }
      expect(wingSign(p, orbit)).toBe(1);
      expect(wingSign(p, 1 - orbit)).toBe(0);

      expect(a.setup).toBe(inverse(a.moves));
      const s0 = run(a.setup as string);
      expect(centresSolved(s0)).toBe(true);
      expect(brokenEdges(s0)).toEqual(['UF']);
      const want = slots.flatMap((t) => (WINGS[wing('UF', t)] as (typeof WINGS)[number]).facelets).sort((x, y) => x - y);
      expect(changed(s0)).toEqual(want);
      const g = group(s0, 'UF');
      const home = group(SOLVED, 'UF')[0] as number;
      for (let t = 1; t <= 4; t++) expect(g[t - 1]).toBe(slots.includes(t) ? flipValue(home) : home);
      expect(isSolved(run(a.moves, s0))).toBe(true);
    });
  }

  it('the two forms look alike: the inner pair disagrees with the outer pair', () => {
    for (const id of ['flip-parity-inner', 'flip-parity-outer']) {
      const g = group(run(alg(id).setup as string), 'UF');
      expect(g[0]).toBe(g[3]);
      expect(g[1]).toBe(g[2]);
      expect(g[1]).toBe(flipValue(g[0] as number));
    }
  });

  it('flip-parity-whole turns the whole top-front group over, which no outer turn can undo', () => {
    const a = alg('flip-parity-whole');
    const p = permOf(a.moves);
    expect(groupSources(p)[edgeIndex('UF')]).toEqual({ from: 'UF', reversed: true });
    expect(wingMoves(p).length).toBe(4);
    expect(cornersFixed(p)).toBe(true);
    expect(centresStayOnTheirFaces(p)).toBe(true);
    const s0 = run(a.setup as string);
    expect(centresSolved(s0)).toBe(true);
    expect(edgesPaired(s0)).toBe(true);
    expect(changed(s0).length).toBe(8);
    const info = analyseReduced(s0);
    expect(info.edgeFlip).toBe(1);
    expect(analyseReduced(SOLVED).edgeFlip).toBe(0);
    const rand = makeRng(9);
    const outer = allHalfBlockMoves().filter(isOuter);
    let s = s0;
    for (let k = 0; k < 200; k++) {
      s = applyMoves(s, [outer[Math.floor(rand() * outer.length)] as Move]);
      expect(analyseReduced(s).edgeFlip).toBe(1);
    }
    expect(isSolved(run(a.moves, s0))).toBe(true);
  });

  it('fixing the wrong form pairs the edge but leaves the group flipped, and the wide version then finishes', () => {
    const inner = alg('flip-parity-inner');
    const outer = alg('flip-parity-outer');
    const whole = alg('flip-parity-whole');
    for (const [got, used] of [
      [inner, outer],
      [outer, inner],
    ] as const) {
      const s = run(used.moves, run(got.setup as string));
      expect(centresSolved(s)).toBe(true);
      expect(edgesPaired(s)).toBe(true);
      expect(isSolved(s)).toBe(false);
      expect(analyseReduced(s).edgeFlip).toBe(1);
      expect(Array.from(s)).toEqual(Array.from(run(whole.setup as string)));
      expect(isSolved(run(whole.moves, s))).toBe(true);
    }
  });

  it('swap-parity swaps the top-front and top-back groups and nothing else that shows', () => {
    const a = alg('swap-parity');
    const p = permOf(a.moves);
    const groups = groupSources(p);
    expect(groups[edgeIndex('UF')]).toEqual({ from: 'UB', reversed: true });
    expect(groups[edgeIndex('UB')]).toEqual({ from: 'UF', reversed: true });
    expect(wingMoves(p).length).toBe(8);
    expect(cornersFixed(p)).toBe(true);
    expect(centresStayOnTheirFaces(p)).toBe(true);
    for (const w of WINGS) {
      if (w.edge === edgeIndex('UF') || w.edge === edgeIndex('UB')) continue;
      expect(p[w.facelets[0]]).toBe(w.facelets[0]);
      expect(p[w.facelets[1]]).toBe(w.facelets[1]);
    }
    expect(parseMoves(a.moves).every((m) => m.q === 2)).toBe(true);
    expect(a.setup).toBe(inverse(a.moves));
    const s0 = run(a.setup as string);
    expect(centresSolved(s0)).toBe(true);
    expect(edgesPaired(s0)).toBe(true);
    expect(changed(s0).length).toBe(8);
    expect(changed(s0).every((i) => rowOf(i) === 0 && (faceOf(i) === F || faceOf(i) === B) && colOf(i) >= 1 && colOf(i) <= 4)).toBe(true);
    const info = analyseReduced(s0);
    expect([info.cornerParity, info.edgeParity, info.edgeFlip, info.cornerTwist]).toEqual([0, 1, 0, 0]);
    expect(isSolved(run(a.moves, s0))).toBe(true);
  });

  it('swapping two groups is two outer swaps and two inner swaps: even for each kind of wing', () => {
    const p = permOf(alg('swap-parity').moves);
    expect(wingsMovedInOrbit(p, 0)).toBe(4);
    expect(wingsMovedInOrbit(p, 1)).toBe(4);
    expect(wingSign(p, 0)).toBe(0);
    expect(wingSign(p, 1)).toBe(0);
    const src = wingSources(p);
    src.forEach((j, i) => expect(src[j]).toBe(i));
  });

  it("the app's own fix is the same but for its last turn, which leaves the top a half turn round", () => {
    const app = movesToString(PLL_PARITY_FIX);
    const mine = alg('swap-parity').moves;
    expect(app.split(' ').slice(0, 5)).toEqual(mine.split(' ').slice(0, 5));
    expect(app.split(' ')[5]).toBe('3Uw2');
    expect((alg('swap-parity') as LearnAlgorithm).note).toContain('3Uw2');
    expect(samePerm(app + ' U2', mine)).toBe(true);
    expect(samePerm(app, mine + ' U2')).toBe(true);
    const s = applyMoves(SOLVED, PLL_PARITY_FIX);
    expect(centresSolved(s)).toBe(true);
    expect(edgesPaired(s)).toBe(true);
    const info = analyseReduced(s);
    expect(info.cornerParity).not.toBe(info.edgeParity);
  });

  it('when the two swapped groups are next to each other, the algorithm still lets a 3x3x3 method finish', () => {
    const a = alg('swap-parity');
    const s0 = run("R B " + a.moves + " B' R'");
    expect(centresSolved(s0)).toBe(true);
    expect(edgesPaired(s0)).toBe(true);
    const p = permOf("R B " + a.moves + " B' R'");
    const swappedGroups = EDGES.filter((e, k) => groupSources(p)[k]?.from !== e.name).map((e) => e.name);
    expect(swappedGroups).toEqual(['UR', 'UF']);
    expect(cornersFixed(p)).toBe(true);
    const before = analyseReduced(s0);
    expect(before.cornerParity).not.toBe(before.edgeParity);
    const s1 = run(a.moves, s0);
    const after = analyseReduced(s1);
    expect(after.cornerParity).toBe(after.edgeParity);
    expect(after.edgeFlip).toBe(0);
    const finish = solveReduced(after.facelets);
    expect(finish.length).toBeGreaterThan(0);
    expect(finish.every(isOuter)).toBe(true);
    expect(isSolved(applyMoves(s1, finish))).toBe(true);
  });
});

describe('topic 7, handling', () => {
  it('an inner layer done as two wide turns is exactly that inner layer', () => {
    const block = alg('inner-as-two-wide') as LearnAlgorithm;
    const all = [block, ...(block.variants ?? [])];
    expect(all.map((a) => a.sameAs)).toEqual(['3R', '2R', '2-3Rw']);
    for (const a of all) {
      expect(parseMoves(a.moves).length).toBe(2);
      expect(parseMoves(a.moves).every((m) => describeMove(m).fromLayer === 1)).toBe(true);
      expect(parseMoves(a.sameAs as string).length).toBe(1);
      expect(samePerm(a.moves, a.sameAs as string), a.id).toBe(true);
    }
    expect(block.purpose).toContain('layer 3 from the right');
  });

  it('pieces put back in other places still give a cube that can be solved; a twisted corner does not', () => {
    prepareSolver();
    const rand = makeRng(31);
    const base = randomState(rand);
    expect(validateState(base).ok).toBe(true);

    const wingsSwapped = base.slice();
    const outerWings = WINGS.filter((w) => w.orbit === 0);
    const [a, b] = [outerWings[2] as (typeof WINGS)[number], outerWings[17] as (typeof WINGS)[number]];
    for (const k of [0, 1] as const) {
      wingsSwapped[a.handed[k]] = base[b.handed[k]] as number;
      wingsSwapped[b.handed[k]] = base[a.handed[k]] as number;
    }
    expect(Array.from(wingsSwapped)).not.toEqual(Array.from(base));
    expect(validateState(wingsSwapped).ok).toBe(true);
    expect(isSolved(applyMoves(wingsSwapped, solveCube(wingsSwapped).steps.map((s) => s.move)))).toBe(true);

    const cornersSwapped = base.slice();
    const [c, d] = [CORNERS[1] as (typeof CORNERS)[number], CORNERS[6] as (typeof CORNERS)[number]];
    for (const k of [0, 1, 2]) {
      cornersSwapped[c.facelets[k] as number] = base[d.facelets[k] as number] as number;
      cornersSwapped[d.facelets[k] as number] = base[c.facelets[k] as number] as number;
    }
    expect(validateState(cornersSwapped).ok).toBe(true);
    expect(isSolved(applyMoves(cornersSwapped, solveCube(cornersSwapped).steps.map((s) => s.move)))).toBe(true);

    const twisted = base.slice();
    const corner = CORNERS[0] as (typeof CORNERS)[number];
    twisted[corner.facelets[0]] = base[corner.facelets[1]] as number;
    twisted[corner.facelets[1]] = base[corner.facelets[2]] as number;
    twisted[corner.facelets[2]] = base[corner.facelets[0]] as number;
    const verdict = validateState(twisted);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.map((p) => p.kind)).toEqual(['twist']);
    expect(verdict.problems[0]?.message).toContain('by hand');
  });
});

describe('topic 8, when the cube does not match', () => {
  it('the three quick fixes land where the step wanted', () => {
    for (const m of allHalfBlockMoves()) {
      const half: Move = { ...m, q: 2 };
      if (m.q !== 2) {
        const wrongWay = composePerm(movePerm({ ...m, q: 4 - m.q }), movePerm(half));
        expect(Array.from(wrongWay)).toEqual(Array.from(movePerm(m)));
        expect(Array.from(composePerm(movePerm(m), movePerm(m)))).toEqual(Array.from(movePerm(half)));
      }
    }
    expect(samePerm("Rw R'", '2R')).toBe(true);
    expect(samePerm('R 2R', 'Rw')).toBe(true);
    expect(samePerm("3Uw 3U'", 'Uw')).toBe(true);
  });

  it('two centre stickers in the same kind of place, read the wrong way round, still pass the colour check', () => {
    const rand = makeRng(41);
    let slipped = 0;
    for (let t = 0; t < 20; t++) {
      const state = randomState(rand);
      const orbit = t % 4;
      const slots = CENTRES.filter((c) => c.orbit === orbit);
      const first = slots[Math.floor(rand() * slots.length)] as (typeof CENTRES)[number];
      const second = slots.find((c) => state[c.facelet] !== state[first.facelet]) as (typeof CENTRES)[number];
      const misread = state.slice();
      misread[first.facelet] = state[second.facelet] as number;
      misread[second.facelet] = state[first.facelet] as number;
      expect(Array.from(misread)).not.toEqual(Array.from(state));
      if (validateState(misread).ok) slipped++;
    }
    expect(slipped).toBe(20);
    const oneWrong = randomState(rand);
    const w = WINGS[5] as (typeof WINGS)[number];
    oneWrong[w.facelets[0]] = ((oneWrong[w.facelets[0]] as number) + 1) % 6;
    expect(validateState(oneWrong).ok).toBe(false);
  });
});

describe('what the guided solve does, as the phase notes and topics describe it', () => {
  interface Trial {
    start: Uint8Array;
    result: SolveResult;
    before: Uint8Array[];
  }
  const trials: Trial[] = [];

  beforeAll(() => {
    prepareSolver();
    const rand = makeRng(606);
    for (let t = 0; t < 12; t++) {
      const start = randomState(rand);
      const result = solveCube(start);
      const before = [start];
      for (const s of result.steps) before.push(applyMoves(before[before.length - 1] as Uint8Array, [s.move]));
      trials.push({ start, result, before });
    }
  });

  it('solves from any position, and one step is always a single turn the notation can name', () => {
    for (const t of trials) {
      expect(isSolved(t.before[t.before.length - 1] as Uint8Array)).toBe(true);
      for (const s of t.result.steps) {
        expect(moveToString(s.move)).toBe(s.notation);
        expect(describeMove(s.move).toLayer).toBeLessThanOrEqual(3);
      }
    }
  });

  it('never meets the flipped-wing parity: its inner layers make the matching number of quarter turns', () => {
    const seen = new Set<number>();
    for (const t of trials) {
      const scheme = deriveScheme(t.start).scheme as Scheme;
      const odd = analyseWings(t.start, scheme).odd;
      const bits = (odd[0] ? 1 : 0) | (odd[1] ? 2 : 0);
      seen.add(bits);
      expect(movesParity(t.result.steps.map((s) => s.move))).toBe(bits);
      const firstFinal = t.result.steps.findIndex((s) => s.phase === '3x3');
      if (firstFinal >= 0) expect(analyseReduced(t.before[firstFinal] as Uint8Array).edgeFlip).toBe(0);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('the final stage turns single outer faces only, on a cube whose centres and edges are whole', () => {
    let finalSteps = 0;
    for (const t of trials) {
      t.result.steps.forEach((s, k) => {
        if (s.phase !== '3x3') return;
        finalSteps++;
        expect(isOuter(s.move), s.notation).toBe(true);
        expect(s.notation).toMatch(/^[URFDLB]['2]?$/);
        expect(centresSolved(t.before[k] as Uint8Array)).toBe(true);
        expect(edgesPaired(t.before[k] as Uint8Array)).toBe(true);
      });
    }
    expect(finalSteps).toBeGreaterThan(100);
  });

  it('the centres look broken for most of the pairing stage', () => {
    let steps = 0;
    let broken = 0;
    for (const t of trials) {
      t.result.steps.forEach((s, k) => {
        if (s.phase !== 'edges') return;
        steps++;
        if (!centresSolved(t.before[k + 1] as Uint8Array)) broken++;
      });
    }
    expect(steps).toBeGreaterThan(300);
    expect(broken / steps).toBeGreaterThan(0.6);
  });

  it('the parity fix turns up in some solves and not others, as about six turns that are mostly half turns', () => {
    const withFix = trials.filter((t) => t.result.counts.parity > 0);
    expect(withFix.length).toBeGreaterThan(0);
    expect(withFix.length).toBeLessThan(trials.length);
    for (const t of withFix) {
      const fix = t.result.steps.filter((s) => s.phase === 'parity');
      expect(fix.length).toBeGreaterThanOrEqual(4);
      expect(fix.length).toBeLessThanOrEqual(8);
      expect(fix.filter((s) => s.move.q === 2).length / fix.length).toBeGreaterThanOrEqual(2 / 3);
      const firstFix = t.result.steps.findIndex((s) => s.phase === 'parity');
      const firstFinal = t.result.steps.findIndex((s) => s.phase === '3x3');
      expect(firstFix).toBeLessThan(firstFinal);
    }
  });
});
