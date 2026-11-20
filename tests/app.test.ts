/**
 * The parts of the app screens that can be checked without a browser: the words for a step, the
 * links from a phase of the solve to its Learn topic, saved progress, and the clock on the solved screen.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { solvedState } from '../src/cube/geometry';
import { allHalfBlockMoves, describeMove, makeRng, parseMove } from '../src/cube/moves';
import { randomState } from '../src/cube/random';
import { LEARN_TOPICS, PHASE_NOTES } from '../src/learn';
import { solveCube } from '../src/solver/index';
import { DEFAULT_NAMES, DEFAULT_PALETTE, PHASE_ORDER, PHASE_SHORT, PHASE_TITLES, PHASE_TOPIC, clearProgress, holdCorner, loadProgress, moveInWords, saveProgress } from '../src/app/model';
import { clock } from '../src/app/ui';

describe('the words for a step', () => {
  it('names the turn kind, the layers and the direction for every one of the 108 moves', () => {
    for (const m of allHalfBlockMoves()) {
      const words = moveInWords(m);
      const d = describeMove(m);
      expect(words.kind).toBe(d.clockwise === 2 ? 'Half turn' : d.clockwise === 1 ? 'Quarter turn clockwise' : 'Quarter turn anticlockwise');
      expect(words.what.length).toBeGreaterThan(10);
      // Clockwise only means something from a named side.
      if (d.clockwise !== 2) expect(words.how).toMatch(/looking at the (right|left|top|bottom|front|back) side/);
    }
  });

  it('says inner slices are counted from the named face', () => {
    expect(moveInWords(parseMove('3R')).what).toBe('Only layer 3 counted from the right (an inner slice)');
    expect(moveInWords(parseMove("2-3Lw'")).what).toBe('Layers 2 to 3 counted from the left, together (inner slices)');
    expect(moveInWords(parseMove('U2')).what).toBe('The top face (outer layer only)');
    expect(moveInWords(parseMove('3Dw')).what).toBe('The 3 outer layers on the bottom, together');
  });
});

describe('phases of the guided solve', () => {
  it('has a title, a short name, a note and an existing Learn topic for every phase', () => {
    const topics = new Set<string>(LEARN_TOPICS.map((t) => t.id));
    for (const phase of PHASE_ORDER) {
      expect(PHASE_TITLES[phase]).toBeTruthy();
      expect(PHASE_SHORT[phase].length).toBeLessThanOrEqual(8);
      expect(PHASE_NOTES[phase].title).toBe(PHASE_TITLES[phase]);
      expect(topics.has(PHASE_TOPIC[phase])).toBe(true);
    }
  });

  it('lists the phases in the order the solver uses them', () => {
    const steps = solveCube(randomState(makeRng(29))).steps;
    let last = 0;
    for (const s of steps) {
      const at = PHASE_ORDER.indexOf(s.phase);
      expect(at).toBeGreaterThanOrEqual(last);
      last = at;
    }
  });
});

describe('the corner to hold', () => {
  it('is the top, front, right corner of the scanned state', () => {
    expect(holdCorner(solvedState())).toEqual([0, 2, 1]);
  });
});

describe('saved progress', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it('keeps the cube, the step and the time spent', () => {
    const state = randomState(makeRng(5));
    saveProgress({ state, palette: DEFAULT_PALETTE, names: DEFAULT_NAMES }, 41, 187, 93500);
    const saved = loadProgress();
    expect(saved?.step).toBe(41);
    expect(saved?.total).toBe(187);
    expect(saved?.ms).toBe(93500);
    expect(Uint8Array.from(saved?.state ?? [])).toEqual(state);
    clearProgress();
    expect(loadProgress()).toBeNull();
  });

  it('ignores anything that is not a saved cube', () => {
    localStorage.setItem('cube6:v1', '{"state":[1,2,3]}');
    expect(loadProgress()).toBeNull();
    localStorage.setItem('cube6:v1', 'not json');
    expect(loadProgress()).toBeNull();
  });
});

describe('the clock on the solved screen', () => {
  it('shows minutes and seconds, and hours only when there are any', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(6400)).toBe('0:06');
    expect(clock(754000)).toBe('12:34');
    expect(clock(3723000)).toBe('1:02:03');
  });
});
