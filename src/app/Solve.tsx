import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isSolved } from '../cube/geometry';
import { applyMove, invertMove } from '../cube/moves';
import { PHASE_NOTES } from '../learn/content';
import type { Phase, SolveStep } from '../solver/index';
import type { CubeView } from '../viewer';
import { launchConfetti } from './confetti';
import { Cube3D } from './Cube3D';
import { PHASE_ORDER, PHASE_SHORT, PHASE_TITLES, PHASE_TOPIC, holdCorner, moveInWords, type CubeData } from './model';
import { Icon, clock, useReducedMotion } from './ui';

interface Props {
  data: CubeData;
  steps: SolveStep[];
  startAt: number;
  /** Time already spent on this solve, in milliseconds. */
  startMs: number;
  onStep: (index: number, ms: number) => void;
  onExit: () => void;
  onAgain: () => void;
  /** Opens Learn; step is where the solve stands, so Learn can offer the way back to it. */
  onLearn: (topic?: string, step?: number) => void;
}

const SPEEDS = [
  { name: 'Slow', turn: 1400, pause: 1600 },
  { name: 'Normal', turn: 800, pause: 900 },
  { name: 'Fast', turn: 350, pause: 300 },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function Solve({ data, steps, startAt, startMs, onStep, onExit, onAgain, onLearn }: Props) {
  const n = steps.length;
  const reduced = useReducedMotion();
  const [index, setIndexState] = useState(Math.min(startAt, n));
  const [intro, setIntro] = useState(startAt === 0 && n > 0);
  const [gate, setGate] = useState<Phase | null>(null);
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [solved, setSolved] = useState(false);
  /** The step the person was on before a jump, kept for a few steps so a slip of the thumb can be undone. */
  const [cameFrom, setCameFrom] = useState<number | null>(null);
  const cameFromRef = useRef<{ step: number; left: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<CubeView | null>(null);
  const confetti = useRef<HTMLCanvasElement>(null);
  const at = useRef(index);
  const busy = useRef(false);
  /** A tap on Next that arrived while a turn was still playing; it runs as soon as that turn ends. */
  const queued = useRef(false);
  const autoRef = useRef(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const hidden = useRef(intro);
  const met = useRef(new Set<Phase>(steps.slice(0, Math.min(startAt, n) + 1).map((s) => s.phase)));
  const spent = useRef(startMs);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // State before each step: states[k] is the cube after k moves.
  const states = useMemo(() => {
    const out = [data.state];
    for (const s of steps) out.push(applyMove(out[out.length - 1] as Uint8Array, s.move));
    return out;
  }, [data.state, steps]);

  // Where each phase starts and ends, for the phase strip and the track under it.
  const spans = useMemo(
    () =>
      PHASE_ORDER.map((phase) => {
        const from = steps.findIndex((s) => s.phase === phase);
        let to = from;
        while (to >= 0 && to < n && (steps[to] as SolveStep).phase === phase) to++;
        return { phase, from, to };
      }),
    [steps],
  );
  const track = useMemo(() => {
    const stops: string[] = [];
    spans
      .filter((s) => s.from >= 0)
      .forEach((s, k) => {
        const colour = k % 2 ? 'var(--surface-3)' : 'var(--surface-2)';
        stops.push(colour + ' ' + ((s.from / n) * 100).toFixed(2) + '%', colour + ' ' + ((s.to / n) * 100).toFixed(2) + '%');
      });
    return stops.length ? 'linear-gradient(to right, ' + stops.join(', ') + ')' : 'var(--surface-2)';
  }, [spans]);

  const setIndex = (k: number): void => {
    at.current = k;
    setIndexState(k);
    onStep(k, spent.current);
  };

  const settle = (k: number): void => {
    const v = view.current;
    if (!v) return;
    const move = k < n && !hidden.current ? (steps[k] as SolveStep).move : null;
    v.showMove(move);
    const done = n > 0 && k === n && isSolved(v.getState());
    setSolved(done);
    if (done && !reducedRef.current) v.spin(0.55);
    else {
      v.spin(0);
      // Turns of the back, left and bottom layers get a view that shows them better.
      v.aim(move, !reducedRef.current);
    }
  };

  const hide = (on: boolean): void => {
    hidden.current = on;
    settle(at.current);
  };

  const jump = (k: number): void => {
    const v = view.current;
    if (!v || busy.current) return;
    v.setState(states[k] as Uint8Array, data.palette);
    for (const s of steps.slice(0, k + 1)) met.current.add(s.phase);
    setGate(null);
    hidden.current = false;
    setIndex(k);
    settle(k);
  };

  /** A jump made with the slider or Restart. Where it left from is offered back, in case it was a slip. */
  const leap = (k: number): void => {
    if (busy.current || k === at.current) return;
    setAuto(false);
    const from = cameFromRef.current?.step ?? at.current;
    cameFromRef.current = k === from ? null : { step: from, left: 3 };
    setCameFrom(cameFromRef.current?.step ?? null);
    jump(k);
  };

  const next = async (ms = 450): Promise<void> => {
    const v = view.current;
    const k = at.current;
    if (busy.current) queued.current = true;
    if (!v || busy.current || k >= n) return;
    busy.current = true;
    queued.current = false;
    await v.animateMove((steps[k] as SolveStep).move, { durationMs: reducedRef.current ? 0 : ms });
    busy.current = false;
    // A new phase starts with a short word on what it is for, and a moment to check the cube.
    const phase = k + 1 < n ? (steps[k + 1] as SolveStep).phase : null;
    if (phase && !met.current.has(phase)) {
      met.current.add(phase);
      hidden.current = true;
      setGate(phase);
      setAuto(false);
      queued.current = false;
    }
    setIndex(k + 1);
    settle(k + 1);
    // Carrying on from the new place for a few steps means the jump was meant.
    if (cameFromRef.current && --cameFromRef.current.left <= 0) {
      cameFromRef.current = null;
      setCameFrom(null);
    }
    if (queued.current) void next(ms);
  };

  const back = async (): Promise<void> => {
    const v = view.current;
    const k = at.current;
    if (!v || busy.current || k <= 0) return;
    busy.current = true;
    v.spin(0);
    v.showMove(null);
    await v.animateMove(invertMove((steps[k - 1] as SolveStep).move), { durationMs: reducedRef.current ? 0 : 260 });
    busy.current = false;
    setGate(null);
    hidden.current = false;
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

  const proceed = (): void => {
    setAuto(false);
    if (gate) {
      setGate(null);
      hide(false);
    } else void next();
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
      if (intro || (e.target as HTMLElement | null)?.closest?.('.layer')) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        proceed();
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
  }, [intro, gate]);

  // Time spent: counted while the steps are on screen and the page is in front.
  useEffect(() => {
    if (intro || solved) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === 'visible' && now - last < 5000) spent.current += now - last;
      last = now;
    }, 1000);
    return () => clearInterval(timer);
  }, [intro, solved]);

  useEffect(() => {
    if (!solved || !confetti.current) return;
    onStep(n, spent.current);
    return launchConfetti(confetti.current, data.palette, reduced, stage.current?.getBoundingClientRect());
  }, [solved]);

  const step = index < n ? (steps[index] as SolveStep) : null;
  const words = step ? moveInWords(step.move) : null;
  const hold = holdCorner(data.state);
  const note = gate ? PHASE_NOTES[gate] : null;
  const chip = (c: number, where: string) => (
    <li>
      <span class="chip">
        <i style={{ background: data.palette[c] }} />
        {data.names[c]}
      </span>
      <span class="where">{where}</span>
    </li>
  );

  return (
    <div class="screen solve">
      <header class="bar">
        <button class="btn ghost" onClick={onExit} data-testid="exit">
          <Icon name="back" />
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
          <small data-testid="phase">{step ? PHASE_TITLES[step.phase] : solved ? 'Solved' : ''}</small>
        </div>
        <button class="btn ghost" onClick={() => onLearn(step ? PHASE_TOPIC[step.phase] : undefined, index)} data-testid="learn">
          <Icon name="book" />
          Learn
        </button>
      </header>

      <div class="stage" ref={stage}>
        <Cube3D
          class="stage-cube"
          onReady={(v) => {
            view.current = v;
            (window as unknown as { __cubeView?: CubeView }).__cubeView = v;
            v.setState(states[at.current] as Uint8Array, data.palette);
            v.markCorner(intro);
            settle(at.current);
          }}
        />
        {!intro && !solved && (
          <button class="btn ghost stage-help" onClick={() => onLearn('recovery', index)} aria-label="Lost? What to do when your cube does not match the picture" data-testid="mismatch">
            <Icon name="help" />
            Lost?
          </button>
        )}
        <button class="btn ghost icon recentre" onClick={() => view.current?.resetCamera(!reduced)} aria-label="Reset the view">
          <Icon name="view" />
        </button>
      </div>

      <div class="side">
        {intro && (
          <div class="intro" role="dialog" aria-label="How to hold the cube">
            <h2>First, hold your cube like the picture</h2>
            <p>Find the corner piece with these three colours. Hold the cube so that corner is at the top, front, right: the corner ringed in the picture.</p>
            <ul>
              {chip(hold[0], 'on top')}
              {chip(hold[1], 'facing you')}
              {chip(hold[2], 'on the right')}
            </ul>
            <p class="dim">Keep the cube this way round until the end. Steps turn layers only, never the whole cube. Drag the picture to look around it.</p>
            <button
              class="btn primary big"
              onClick={() => {
                setIntro(false);
                view.current?.markCorner(false);
                hide(false);
              }}
              data-testid="begin"
            >
              My cube matches, start
            </button>
          </div>
        )}

        {solved && (
          <div class="solved-panel" data-testid="done">
            <h2>Solved!</h2>
            <p>All six sides are done, and you turned every layer yourself.</p>
            <div class="tray stats">
              <div class="stat">
                <b data-testid="stat-steps">{n}</b>
                <span>turns</span>
              </div>
              <div class="stat">
                <b data-testid="stat-time">{clock(spent.current)}</b>
                <span>time on the steps</span>
              </div>
            </div>
            <button class="btn primary big" onClick={onAgain} data-testid="again">
              Solve another cube
            </button>
            <div class="row" style={{ justifyContent: 'center' }}>
              <button class="link" onClick={() => void back()}>
                Step back through it
              </button>
              <button class="link" onClick={() => onLearn(undefined, n)}>
                How the method works
              </button>
              <button class="link" onClick={() => onLearn('recovery', n)}>
                My cube is not solved
              </button>
            </div>
          </div>
        )}

        <div class="guide-panel" hidden={intro || solved}>
          <nav class="phases" aria-label="Phases of the solve">
            {spans.map((s) => {
              const state = s.from < 0 ? 'skip' : index >= s.to ? 'done' : index >= s.from ? 'now' : '';
              return (
                <button
                  class={'phase-chip ' + state}
                  disabled={s.from < 0}
                  aria-current={state === 'now' ? 'step' : undefined}
                  onClick={() => {
                    setAuto(false);
                    setGate(gate === s.phase ? null : s.phase);
                    hide(gate !== s.phase);
                  }}
                >
                  {state === 'done' && <Icon name="check" />}
                  {PHASE_SHORT[s.phase]}
                </button>
              );
            })}
          </nav>

          {note && gate ? (
            <section class="phase-note" aria-live="polite" data-testid="phase-note">
              <h3>{note.title}</h3>
              <p>{note.goal}</p>
              <p class="dim">{note.watchFor}</p>
              <p class="dim">
                <b>Tip:</b> {note.tip}
              </p>
              <button class="link" onClick={() => onLearn(PHASE_TOPIC[gate], index)}>
                More about this in Learn
              </button>
            </section>
          ) : (
            <section class="move" aria-live="polite">
              {step && words ? (
                <>
                  <div class="move-top">
                    <span class="notation" data-testid="notation">
                      {step.notation}
                    </span>
                    <span class="turn-kind">{words.kind}</span>
                    {cameFrom !== null && (
                      <button class="btn small return" onClick={() => leap(cameFrom)} data-testid="return">
                        <Icon name="undo" />
                        {cameFrom >= n ? 'Back to the end' : 'Back to step ' + (cameFrom + 1)}
                      </button>
                    )}
                  </div>
                  <div class="words">
                    <b>{words.what}</b>
                    <span>{words.how}</span>
                  </div>
                </>
              ) : (
                <div class="words" data-testid={solved ? undefined : 'done'}>
                  <b>{n === 0 ? 'This cube is already solved.' : 'No steps left.'}</b>
                  <span>{n === 0 ? 'There is nothing to turn.' : 'If your cube does not match the picture, go back to find where it went a different way.'}</span>
                </div>
              )}
            </section>
          )}

          <input
            class="scrub"
            type="range"
            min={0}
            max={n}
            value={index}
            style={{ '--track': track }}
            aria-label="Step"
            onInput={(e) => leap(Number((e.target as HTMLInputElement).value))}
          />

          <div class="controls">
            <button class="btn stack" onClick={() => leap(0)} disabled={index === 0} data-testid="start">
              <Icon name="restart" />
              Restart
            </button>
            <button class="btn stack" onClick={() => void replay()} disabled={!step || auto || !!gate} data-testid="replay">
              <Icon name="replay" />
              Show turn
            </button>
            <button class={'btn stack' + (auto ? ' on' : '')} onClick={() => (gate && proceed(), setAuto(!auto))} disabled={!step} aria-pressed={auto} data-testid="auto">
              <Icon name={auto ? 'pause' : 'play'} />
              {auto ? 'Pause' : 'Auto'}
            </button>
            <button class="btn stack" onClick={() => setSpeed((speed + 1) % SPEEDS.length)} aria-label={'Auto-play speed: ' + (SPEEDS[speed] as (typeof SPEEDS)[number]).name} data-testid="speed">
              <Icon name="speed" />
              {(SPEEDS[speed] as (typeof SPEEDS)[number]).name}
            </button>
          </div>
          <footer class="actions sticky">
            <button class="btn back" onClick={() => (setAuto(false), void back())} disabled={index === 0} data-testid="back" aria-label="Back one step">
              <Icon name="back" />
            </button>
            <button class="btn primary grow next" onClick={proceed} disabled={(!step && !gate) || intro} data-testid="next">
              {gate ? 'Got it, continue' : step ? 'Done, next step' : 'Finished'}
            </button>
          </footer>
        </div>
      </div>
      {solved && <canvas class="confetti" ref={confetti} aria-hidden="true" />}
    </div>
  );
}
