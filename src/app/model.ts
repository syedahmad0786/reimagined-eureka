import { F, R, B, L, U, D, faceletIndex } from '../cube/geometry';
import { describeMove, type Move } from '../cube/moves';
import type { FaceSample, Quad } from '../vision';
import type { Phase } from '../solver/index';

export interface FacePhoto {
  image: ImageData;
  quad: Quad;
  sample: FaceSample;
}

export interface CubeData {
  state: Uint8Array;
  /** CSS colour per colour id. */
  palette: string[];
  /** Display name per colour id. */
  names: string[];
  confidence?: Float32Array;
  costs?: Float32Array;
  /** Photos by face id (U R F D L B) when the state came from a scan. */
  photos?: (FacePhoto | null)[];
}

export const DEFAULT_PALETTE = ['#f3f3ef', '#d92b2b', '#2dbd4e', '#ffd41f', '#ff8a1c', '#1f6fe0'];
export const DEFAULT_NAMES = ['white', 'red', 'green', 'yellow', 'orange', 'blue'];

export const FACE_TITLES = ['Top', 'Right', 'Front', 'Bottom', 'Left', 'Back'];

/** The order the faces are photographed in, and how the cube is held for each. */
export interface CaptureStep {
  face: number;
  /** Face that is at the top of the photo. */
  up: number;
  title: string;
  how: string;
}

export const CAPTURE_STEPS: CaptureStep[] = [
  { face: F, up: U, title: 'Front', how: 'Hold the cube with any side facing you. That side is now the front, and the side on top stays the top until photo 5.' },
  { face: R, up: U, title: 'Right', how: 'Turn the whole cube a quarter turn to the left, like turning a page, so its right side faces you. Same side on top.' },
  { face: B, up: U, title: 'Back', how: 'Another quarter turn to the left. Same side on top.' },
  { face: L, up: U, title: 'Left', how: 'One more quarter turn to the left. Same side on top.' },
  { face: U, up: B, title: 'Top', how: 'Turn once more to the left so the front faces you again. Then tip the top towards you until you look straight at it.' },
  { face: D, up: F, title: 'Bottom', how: 'Tip the cube back upright, then keep tipping the other way, top away from you, until the bottom faces you.' },
];

/** Neighbouring faces at the top, right, bottom and left of each face as it is read. */
export const NEIGHBOURS: number[][] = [
  [B, R, F, L],
  [U, B, D, F],
  [U, R, D, L],
  [F, R, B, L],
  [U, F, D, B],
  [U, L, D, R],
];

export const PHASE_TITLES: Record<Phase, string> = {
  centres: 'Centres',
  edges: 'Edge pairing',
  parity: 'Parity fix',
  '3x3': 'Final 3x3 stage',
};

const FACE_WORD: Record<string, string> = { R: 'right', L: 'left', U: 'top', D: 'bottom', F: 'front', B: 'back' };

export function moveInWords(m: Move): { what: string; how: string } {
  const d = describeMove(m);
  const face = FACE_WORD[d.face] as string;
  let what: string;
  if (d.fromLayer === 1 && d.toLayer === 1) what = 'The ' + face + ' face (outer layer only)';
  else if (d.fromLayer === 1) what = 'The ' + d.toLayer + ' outer layers on the ' + face + ', together';
  else if (d.fromLayer === d.toLayer) what = 'Only layer ' + d.fromLayer + ' counted from the ' + face + ' (an inner slice)';
  else what = 'Layers ' + d.fromLayer + ' to ' + d.toLayer + ' counted from the ' + face + ', together (inner slices)';
  const how = d.clockwise === 2 ? 'Half turn (180\u00b0)' : 'Quarter turn ' + (d.clockwise === 1 ? 'clockwise' : 'anticlockwise') + ', looking at the ' + face + ' face';
  return { what, how };
}

/** Colours of the top-right-front corner: [on top, facing you, on the right]. */
export function holdCorner(state: ArrayLike<number>): [number, number, number] {
  return [state[faceletIndex(U, 5, 5)] as number, state[faceletIndex(F, 0, 5)] as number, state[faceletIndex(R, 0, 0)] as number];
}

export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : n + ' ' + k;
  });
}

const STORE_KEY = 'cube6:v1';

export interface Saved {
  state: number[];
  palette: string[];
  names: string[];
  step: number;
  total: number;
}

export function saveProgress(data: CubeData, step: number, total: number): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ state: Array.from(data.state), palette: data.palette, names: data.names, step, total } satisfies Saved));
  } catch {
    // Private mode or a full store: the solve still works, it just cannot be resumed.
  }
}

export function loadProgress(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!Array.isArray(s.state) || s.state.length !== 216 || !Array.isArray(s.palette) || s.palette.length !== 6) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // nothing to clear
  }
}
