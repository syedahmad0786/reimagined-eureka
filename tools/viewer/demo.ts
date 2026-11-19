/**
 * Demo page for the 3D cube viewer (demo/viewer.html). Also the page the browser tests drive:
 * window.__view is the CubeView, window.__CubeView the class, window.__cube the cube helpers and
 * window.__palette the colours.
 */
import { CubeView } from '../../src/viewer';
import * as geometry from '../../src/cube/geometry';
import * as moves from '../../src/cube/moves';

const PALETTE = ['#f3f3ef', '#d92b2b', '#2dbd4e', '#ffd41f', '#ff8a1c', '#1f6fe0'];
const SPEEDS = [450, 1000, 2000, 80, 200];
const POSES: ({ front: number; up: number } | null)[] = [
  { front: geometry.F, up: geometry.U },
  { front: geometry.R, up: geometry.U },
  { front: geometry.B, up: geometry.U },
  { front: geometry.L, up: geometry.U },
  { front: geometry.U, up: geometry.B },
  { front: geometry.D, up: geometry.F },
  null,
];

const el = (id: string) => document.getElementById(id) as HTMLElement;
const params = new URLSearchParams(location.search);
for (const name of ['cube-arrow', 'cube-arrow-edge']) {
  const value = params.get(name);
  if (value) el('stage').style.setProperty('--' + name, value);
}
const view = new CubeView(el('stage'), { interactive: params.get('interactive') !== '0', faceLabels: params.get('labels') !== '0' });
const rand = moves.makeRng(Number(params.get('seed') ?? Date.now()));

let state = geometry.solvedState();
let pending: moves.Move | null = null;
let speed = 0;
let pose = -1;
let auto = false;
let done = 0;

function show(state_: Uint8Array): void {
  state = state_;
  view.setState(state, PALETTE);
}

function info(): void {
  el('move').textContent = pending ? moves.moveToString(pending) : '\u00a0';
  el('info').textContent = done + ' moves done' + (geometry.isSolved(state) ? ', solved' : '');
}

function next(): void {
  pending = moves.randomMoves(1, rand)[0] as moves.Move;
  view.showMove(pending);
  info();
}

async function turn(): Promise<void> {
  if (!pending) next();
  const m = pending as moves.Move;
  pending = null;
  state = moves.applyMove(state, m);
  done++;
  await view.animateMove(m, { durationMs: SPEEDS[speed] });
  info();
}

el('next').onclick = next;
el('turn').onclick = () => void turn();
el('scramble').onclick = () => {
  pending = null;
  show(moves.applyMoves(geometry.solvedState(), moves.randomMoves(80, rand)));
  info();
};
el('solved').onclick = () => {
  pending = null;
  done = 0;
  show(geometry.solvedState());
  info();
};
el('speed').onclick = () => {
  speed = (speed + 1) % SPEEDS.length;
  el('speed').textContent = SPEEDS[speed] + ' ms';
};
el('auto').onclick = async () => {
  auto = !auto;
  el('auto').textContent = auto ? 'Stop' : 'Auto play';
  while (auto) {
    next();
    if ((SPEEDS[speed] as number) >= 450) await new Promise((r) => setTimeout(r, 700));
    await turn();
  }
};
el('pose').onclick = () => {
  pose = (pose + 1) % POSES.length;
  const p = POSES[pose] ?? null;
  view.highlightFace(p ? p.front : null, p ? { upToward: p.up } : {});
  void view.setPose(p);
  el('info').textContent = p ? 'photograph ' + geometry.FACE_NAMES[p.front] + ' face, ' + geometry.FACE_NAMES[p.up] + ' side up' : 'reference pose';
};
el('camera').onclick = () => view.resetCamera();

show(state);
info();
Object.assign(window, { __view: view, __CubeView: CubeView, __cube: { ...geometry, ...moves }, __palette: PALETTE });
