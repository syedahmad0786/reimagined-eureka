/** The conditions the synthetic test set covers, and the random photo parameters for each. */
import { applyMove, type Move, type Axis } from '../../src/cube/moves';
import { solvedState } from '../../src/cube/geometry';
import type { ShotParams } from './shot';

export const PALETTES: Record<string, string[]> = {
  /** Albedos chosen so that a neutral, fully lit render lands on the top-face colours measured in the reference photos. */
  ahmad: ['#fd8123', '#dcdfda', '#42d152', '#eedc32', '#ca3938', '#2270b8'],
  /** Classic stickered cube (Rubik's brand shades). */
  classic: ['#ff5800', '#f2f2f2', '#009b48', '#ffd500', '#b71234', '#0046ad'],
  /** A scheme with no orange, red or yellow at all: pink, white, lime, purple, black, cyan. */
  unusual: ['#f48fb1', '#f0f0f0', '#b6e024', '#7b2fbf', '#1c1c1e', '#19c3d6'],
};
export const PALETTE_NAMES: Record<string, string[]> = {
  ahmad: ['orange', 'white', 'green', 'yellow', 'red', 'blue'],
  classic: ['orange', 'white', 'green', 'yellow', 'red', 'blue'],
  unusual: ['pink', 'white', 'lime', 'purple', 'black', 'cyan'],
};

export const CONDITIONS = ['easy', 'warm-dim', 'cool-bright', 'gradient-shadow', 'glare', 'tilt-roll', 'clutter', 'noisy-blur-jpeg', 'stickered', 'mixed-hard', 'unusual-scheme'] as const;
export type Condition = (typeof CONDITIONS)[number];

export function randomState(rnd: () => number, moves = 90): number[] {
  let s = solvedState();
  for (let i = 0; i < moves; i++) {
    const lo = Math.floor(rnd() * 6);
    const hi = lo + Math.floor(rnd() * (6 - lo));
    const m: Move = { axis: Math.floor(rnd() * 3) as Axis, lo, hi, q: 1 + Math.floor(rnd() * 3) };
    if (lo === 0 && hi === 5) continue;
    s = applyMove(s, m);
  }
  return Array.from(s);
}

type Rgb = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** t = -1 warm lamp, 0 daylight, +1 cool shade. */
function tint(t: number): Rgb {
  return t < 0 ? [1, lerp(1, 0.78, -t), lerp(1, 0.52, -t)] : [lerp(1, 0.8, t), lerp(1, 0.9, t), 1];
}

export function paletteFor(cond: Condition): { palette: string; style: 'stickerless' | 'stickered' } {
  if (cond === 'stickered') return { palette: 'classic', style: 'stickered' };
  if (cond === 'unusual-scheme') return { palette: 'unusual', style: 'stickered' };
  return { palette: 'ahmad', style: 'stickerless' };
}

/** Photo parameters for one shot under a condition. The caller adds state, palette, face or view. */
export function shotFor(cond: Condition, kind: 'face' | 'corner', rnd: () => number, seed: number): Omit<ShotParams, 'state' | 'palette' | 'style' | 'face' | 'view'> {
  const r = (a: number, b: number) => lerp(a, b, rnd());
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T;
  const hard = cond === 'mixed-hard';
  let temp = r(-0.25, 0.25);
  let gain = r(0.92, 1.06);
  let tilt = r(0, 8);
  let roll = r(-6, 6);
  let distance = kind === 'face' ? r(11.5, 17) : r(17, 24);
  let noise = r(1, 2.5);
  let blur = r(0.5, 0.9);
  let jpeg = r(0.82, 0.93);
  let gradient = r(0, 0.08);
  let bg: ShotParams['background']['type'] = pick(['plain', 'gradient', 'wood', 'paper']);
  let roughness = r(0.35, 0.5);
  let clearcoat = r(0.15, 0.35);
  let clearcoatRoughness = r(0.25, 0.4);
  let glare: ShotParams['light']['glare'];
  let lamp: ShotParams['light']['lamp'];
  let occluder: ShotParams['light']['occluder'];
  let ambient = r(0.36, 0.48);
  let key = r(0.55, 0.72);
  if (cond === 'easy') {
    tilt = r(0, 4);
    roll = r(-3, 3);
    bg = 'plain';
    jpeg = 0;
    noise = 0.5;
    temp = r(-0.1, 0.1);
  }
  if (cond === 'warm-dim' || (hard && rnd() < 0.35)) {
    temp = r(-1, -0.6);
    gain = r(0.5, 0.7);
    noise = r(4, 6.5);
    if (!hard) bg = 'wood';
  }
  if (cond === 'cool-bright' || (hard && rnd() < 0.3)) {
    temp = r(0.6, 1);
    gain = r(1.1, 1.28);
    if (!hard) bg = pick(['plain', 'gradient']);
  }
  if (cond === 'gradient-shadow' || hard) {
    gradient = r(0.22, hard ? 0.36 : 0.45);
    if (kind === 'face') lamp = { position: [r(-9, 9), r(-9, 9), r(6, 10)], intensity: r(0.25, 0.5), color: tint(r(-0.6, 0.3)) };
    else lamp = { position: [r(4, 10), r(3, 9), r(4, 10)], intensity: r(0.25, 0.5), color: tint(r(-0.6, 0.3)) };
    if (rnd() < 0.5) occluder = { offset: r(-2.5, 2.5), angleDeg: r(0, 360) };
    if (!hard) bg = 'paper';
  }
  if (cond === 'glare' || (hard && rnd() < 0.5)) {
    // A lamp reflected in the glossy plastic: a hot spot about one to three stickers across.
    roughness = r(0.2, 0.3);
    clearcoat = r(0.5, 0.8);
    clearcoatRoughness = r(0.1, 0.18);
    glare = { u: r(0.1, 0.9), v: r(0.1, 0.9), intensity: r(0.12, 0.3), distance: r(14, 30), face: Math.floor(rnd() * 3) };
  }
  if (cond === 'tilt-roll') {
    tilt = r(12, 20);
    roll = r(-20, 20);
    distance = kind === 'face' ? r(11.5, 21) : r(16, 27);
    bg = pick(['paper', 'wood']);
  }
  if (hard) {
    tilt = r(8, 18);
    roll = r(-15, 15);
    noise = r(4, 8);
    blur = r(1, 1.6);
    jpeg = r(0.5, 0.7);
    bg = pick(['plain', 'gradient', 'wood', 'paper', 'clutter']);
  }
  if (cond === 'clutter') {
    bg = 'clutter';
    tilt = r(5, 12);
  }
  if (cond === 'noisy-blur-jpeg') {
    noise = r(7, 12);
    blur = r(1.2, 2.2);
    jpeg = r(0.35, 0.55);
  }
  const lightTint = tint(temp * 0.7);
  const wbError = tint(temp * 0.3 + r(-0.08, 0.08));
  const plainBases: Rgb[] = [
    [0.92, 0.92, 0.9],
    [0.6, 0.6, 0.62],
    [0.15, 0.15, 0.17],
    [0.82, 0.74, 0.6],
    [0.3, 0.42, 0.5],
  ];
  // Key light: mostly from the camera side so the photographed faces are lit; corner shots light the top most.
  const keyDir: Rgb = kind === 'face' ? [r(-0.9, 0.9), r(-0.9, 0.9), 1] : [r(0.1, 0.8), r(0.9, 1.6), r(0.1, 0.8)];
  if (kind === 'corner') {
    ambient *= 0.8;
    key *= 1.25;
  }
  return {
    width: 750,
    height: 1000,
    kind,
    camera: {
      distance,
      fovDeg: 50,
      tiltDeg: tilt,
      tiltAzimuthDeg: r(0, 360),
      rollDeg: roll,
      aimX: r(-0.7, 0.7),
      aimY: r(-0.7, 0.7),
      elevationDeg: r(30, 46),
      swingDeg: r(-11, 11),
    },
    light: { ambient, ambientColor: tint(temp * 0.7 + r(-0.1, 0.25)), key, keyColor: lightTint, keyDir, lamp, glare, occluder },
    material: { roughness, clearcoat, clearcoatRoughness },
    background: { type: bg, seed: Math.floor(rnd() * 1e9), base: pick(plainBases) },
    post: { gain, whiteBalance: wbError, gradient: { angleDeg: r(0, 360), strength: gradient }, blurPx: blur, noiseSigma: noise, jpegQuality: jpeg },
    seed,
  };
}
