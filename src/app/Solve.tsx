import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isSolved } from '../cube/geometry';
import { applyMove, invertMove } from '../cube/moves';
import type { SolveStep } from '../solver/index';
import type { CubeView } from '../viewer';
import { Cube3D } from './Cube3D';
import { PHASE_TITLES, holdCorner, moveInWords, type CubeData } from './model';

interface Props {
  data: CubeData;
  steps: SolveStep[];
  startAt: number;
  onStep: (index: number) => void;
  onExit: () => void;
}

const SPEEDS = [
  { name: 'Slow', turn: 1400, pause: 1600 },
  { name: 'Normal', turn: 800, pause: 900 },
  { name: 'Fast', turn: 350, pause: 300 },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function Solve({ data, steps, startAt, onStep, onExit }: Props) {
  const n = steps.length;
  const [index, setIndexState] = useState(Math.min(startAt, n));
  const [intro, setIntro] = useState(startAt === 0 && n > 0);
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [solved, setSolved] = useState(false);
  const view = useRef<CubeView | null>(null);
  const at = useRef(index);
  const busy = useRef(false);
  const autoRef = useRef(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const introRef = useRef(intro);

  // State before each step: states[k] is the cube after k moves.
  const states = useMemo(() => {
    const out = [data.state];
    for (const s of steps) out.push(applyMove(out[out.length - 1] as Uint8Array, s.move));
    return out;
  }, [data.state, steps]);

  const setIndex = (k: number): void => {
    at.current = k;
    setIndexState(k);
    onStep(k);
  };

  const settle = (k: number): void => {
    const v = view.current;
    if (!v) return;
    v.showMove(k < n && !introRef.current ? (steps[k] as SolveStep).move : null);
    setSolved(k === n && isSolved(v.getState()));
  };

  const jump = (k: number): void => {
    const v = view.current;
    if (!v || busy.current) return;
    v.setState(states[k] as Uint8Array, data.palette);
    setIndex(k);
    settle(k);
  };

  const next = async (ms = 450): Promise<void> => {
    const v = view.current;
    const k = at.current;
    if (!v || busy.current || k >= n) return;
    busy.current = true;
    await v.animateMove((steps[k] as SolveStep).move, { durationMs: ms });
    busy.current = false;
    setIndex(k + 1);
    settle(k + 1);
  };

  const back = async (): Promise<void> => {
    const v = view.current;
    const k = at.current;
    if (!v || busy.current || k <= 0) return;
    busy.current = true;
    v.showMove(null);
    await v.animateMove(invertMove((steps[k - 1] as SolveStep).move), { durationMs: 260 });
    busy.current = false;
    setIndex(k - 1);
    settle(k - 1);
  };

  /** Plays the current step on screen, then puts the cube back so it still matches the one in the hand. */
  const replay = async (): Promise<void> => {
    const v = view.current;
    const k = at.current;
    if (!v || busy.current || k >= n) return;
    busy.current = true;
    await v.animateMove((steps[k] as SolveStep).move, { durationMs: 1100 });
    await sleep(500);
    v.setState(states[k] as Uint8Array, data.palette);
    busy.current = false;
    settle(k);
  };

  useEffect(() => {
    autoRef.current = auto;
    if (!auto) return;
    let alive = true;
    (async () => {
      while (alive && autoRef.current && at.current < n) {
        const s = SPEEDS[speedRef.current] as (typeof SPEEDS)[number];
        await sleep(s.pause);
        if (!alive || !autoRef.current) break;
        await next(s.turn);
      }
      if (alive) setAuto(false);
    })();
    return () => {
      alive = false;
    };
  }, [auto]);

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (intro) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        void next();
      } else if (e.key === 'ArrowLeft') void back();
    };
    window.addEventListener('keydown', key);
    // Keep the phone awake while the cube is in the other hand.
    let lock: { release(): Promise<void> } | null = null;
    const wake = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    wake?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => {
      window.removeEventListener('keydown', key);
      void lock?.release();
    };
  }, [intro]);

  const step = index < n ? (steps[index] as SolveStep) : null;
  const words = step ? moveInWords(step.move) : null;
  const hold = holdCorner(data.state);
  const chip = (c: number) => (
    <span class="chip">
      <i style={{ background: data.palette[c] }} />
      {data.names[c]}
    </span>
  );

  return (
    <div class="screen solve">
      <header class="bar">
        <button class="btn ghost" onClick={onExit}>
          Exit
        </button>
        <div class="bar-title" data-testid="counter">
          {step ? (
            <>
              Step <b>{index + 1}</b> of {n}
            </>
          ) : (
            <>All {n} steps done</>
          )}
        </div>
        <div class="phase" data-testid="phase">
          {step ? PHASE_TITLES[step.phase] : solved ? 'Solved' : ''}
        </div>
      </header>

      <div class="stage">
        <Cube3D
          class="stage-cube"
          onReady={(v) => {
            view.current = v;
            (window as unknown as { __cubeView?: CubeView }).__cubeView = v;
            v.setState(states[at.current] as Uint8Array, data.palette);
            settle(at.current);
          }}
        />
        <button class="btn small recentre" onClick={() => view.current?.resetCamera(true)}>
          Reset view
        </button>
      </div>

      {intro && (
        <div class="intro" role="dialog" aria-label="How to hold the cube">
          <h2>First, hold your cube like the picture</h2>
          <p>Find the corner piece with these three colours. Hold the cube so that corner is at the top, front, right:</p>
          <ul>
            <li>{chip(hold[0])} up</li>
            <li>{chip(hold[1])} towards you</li>
            <li>{chip(hold[2])} right</li>
          </ul>
          <p class="dim">Keep the cube this way round until the end. Steps turn layers only, never the whole cube. You can drag the picture to look around it.</p>
          <button class="btn primary big" onClick={() => {
              introRef.current = false;
              setIntro(false);
              settle(at.current);
            }} data-testid="begin">
            My cube matches, start
          </button>
        </div>
      )}

      <div class="guide-panel" hidden={intro}>
      <section class="move" aria-live="polite">
        {step && words ? (
          <>
            <div class="notation" data-testid="notation">
              {step.notation}
            </div>
            <div class="words">
              <b>{words.what}</b>
              <span>{words.how}</span>
            </div>
          </>
        ) : (
          <div class="words done" data-testid="done">
            <b>{solved ? 'Solved. All six sides are done.' : 'No steps left.'}</b>
            <span>{n === 0 ? 'This cube was already solved.' : 'If your cube does not match the picture, go back to find where it went a different way.'}</span>
          </div>
        )}
      </section>

      <input
        class="scrub"
        type="range"
        min={0}
        max={n}
        value={index}
        aria-label="Step"
        onInput={(e) => {
          setAuto(false);
          jump(Number((e.target as HTMLInputElement).value));
        }}
      />

      <div class="controls">
        <button class="btn" onClick={() => (setAuto(false), jump(0))} disabled={index === 0} data-testid="start">
          Start
        </button>
        <button class="btn" onClick={() => (setAuto(false), void back())} disabled={index === 0} data-testid="back">
          Back
        </button>
        <button class="btn" onClick={() => void replay()} disabled={!step || auto} data-testid="replay">
          Show turn
        </button>
        <button class={'btn' + (auto ? ' on' : '')} onClick={() => setAuto(!auto)} disabled={!step} aria-pressed={auto} data-testid="auto">
          {auto ? 'Pause' : 'Auto'}
        </button>
        <button class="btn" onClick={() => setSpeed((speed + 1) % SPEEDS.length)} aria-label={'Auto-play speed: ' + (SPEEDS[speed] as (typeof SPEEDS)[number]).name} data-testid="speed">
          {(SPEEDS[speed] as (typeof SPEEDS)[number]).name}
        </button>
      </div>
      <footer class="actions sticky">
        <button class="btn primary grow big" onClick={() => (setAuto(false), void next())} disabled={!step || intro} data-testid="next">
          {step ? 'Done, next step' : 'Finished'}
        </button>
      </footer>
      </div>
    </div>
  );
}
