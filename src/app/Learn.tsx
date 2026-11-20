/**
 * Learn: how a 6x6x6 is solved by hand, as short topics. Opens as a layer over whatever screen was
 * showing, so a solve in progress stays exactly where it was. The words and algorithms come from
 * src/learn/content.ts, where every algorithm is checked on the move engine by tests/learn.test.ts.
 */
import { createContext } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { solvedState } from '../cube/geometry';
import { applyMoves, parseMoves, moveToString, type Move } from '../cube/moves';
import { LEARN_TOPICS, type LearnAlgorithm, type LearnBlock } from '../learn/content';
import type { CubeView } from '../viewer';
import { Cube3D } from './Cube3D';
import { DEFAULT_PALETTE } from './model';
import { Icon, useReducedMotion } from './ui';

interface Props {
  /** Topic to open straight away. */
  topic?: string;
  /** Colours for the six sides of the example cubes (top, right, front, bottom, left, back): the user's own when a solve is open. */
  palette?: readonly string[];
  /** Words for a button that stays in reach and closes Learn, such as "Back to step 12". */
  back?: string;
  onClose: () => void;
}

const Palette = createContext<readonly string[]>(DEFAULT_PALETTE);

/** One algorithm with its other forms: pick a form, read its moves, and play it on a 3D cube. */
function Algorithm({ block }: { block: LearnAlgorithm }) {
  const [pick, setPick] = useState(0);
  const forms = [{ id: block.id, label: 'The main form', moves: block.moves, setup: block.setup, sameAs: block.sameAs }, ...(block.variants ?? [])];
  const form = forms[pick] as (typeof forms)[number];
  return (
    <div class="tray alg" data-testid={'alg-' + block.id}>
      <div class="alg-body">
        <h3>{block.name}</h3>
        <p>{block.purpose}</p>
        {forms.length > 1 && (
          <div class="alg-forms" role="group" aria-label="Forms of this algorithm">
            {forms.map((f, k) => (
              <button class={'btn small' + (k === pick ? ' on' : '')} aria-pressed={k === pick} onClick={() => setPick(k)}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        <Player key={form.id} id={form.id} moves={form.moves} setup={form.setup} />
        {form.sameAs && (
          <p>
            Together these do exactly what the single turn <code>{form.sameAs}</code> does.
          </p>
        )}
        {block.note && <p>{block.note}</p>}
      </div>
    </div>
  );
}

/** The moves of one form, and the case on a 3D cube with the moves played one at a time. */
function Player({ id, moves: text, setup }: { id: string; moves: string; setup?: string }) {
  const block = { id, moves: text, setup };
  const reduced = useReducedMotion();
  const palette = useContext(Palette);
  const moves = useMemo(() => parseMoves(block.moves), [block.moves]);
  const start = useMemo(() => applyMoves(solvedState(), block.setup ? parseMoves(block.setup) : []), [block.setup]);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(0);
  const [playing, setPlaying] = useState(false);
  const view = useRef<CubeView | null>(null);
  const at = useRef(0);
  const busy = useRef(false);
  const run = useRef(0);

  const show = (k: number): void => {
    at.current = k;
    setDone(k);
    view.current?.showMove(k < moves.length ? (moves[k] as Move) : null);
  };

  const reset = (): void => {
    run.current++;
    setPlaying(false);
    busy.current = false;
    view.current?.setState(start, palette);
    show(0);
  };

  const step = async (ms: number): Promise<boolean> => {
    const v = view.current;
    const k = at.current;
    if (!v || busy.current || k >= moves.length) return false;
    const mine = run.current;
    busy.current = true;
    await v.animateMove(moves[k] as Move, { durationMs: ms });
    if (mine !== run.current) return false;
    busy.current = false;
    show(k + 1);
    return true;
  };

  const play = async (): Promise<void> => {
    if (at.current >= moves.length) reset();
    const mine = ++run.current;
    busy.current = false;
    setPlaying(true);
    while (mine === run.current && at.current < moves.length) {
      await new Promise((r) => setTimeout(r, reduced ? 700 : 350));
      if (mine !== run.current) return;
      if (!(await step(reduced ? 0 : 650))) break;
    }
    if (mine === run.current) setPlaying(false);
  };

  useEffect(() => () => void run.current++, []);

  return (
    <>
        <div class="alg-moves" aria-label={'Moves: ' + block.moves} data-testid={'moves-' + block.id}>
          {moves.map((m, k) => (
            <code class={open && k === done ? 'now' : open && k < done ? 'done' : ''}>{moveToString(m)}</code>
          ))}
        </div>
        {open && (
          <div class="alg-stage">
            <Cube3D
              onReady={(v) => {
                view.current = v;
                v.setState(start, palette);
                show(0);
              }}
            />
          </div>
        )}
        {open ? (
          <div class="actions">
            <button class="btn icon" onClick={reset} aria-label="Back to the start">
              <Icon name="restart" />
            </button>
            <button class="btn grow" onClick={() => (playing ? (run.current++, (busy.current = false), setPlaying(false)) : void play())} data-testid="alg-play">
              <Icon name={playing ? 'pause' : 'play'} />
              {playing ? 'Pause' : done >= moves.length ? 'Play again' : 'Play'}
            </button>
            <button class="btn primary grow" onClick={() => void step(reduced ? 0 : 450)} disabled={playing || done >= moves.length} data-testid="alg-step">
              <Icon name="step" />
              {done >= moves.length ? 'Done' : 'One turn'}
            </button>
          </div>
        ) : (
          <button class="btn" onClick={() => setOpen(true)} data-testid="alg-show">
            <Icon name="corner" />
            Show it on a cube
          </button>
        )}
    </>
  );
}

function Block({ block }: { block: LearnBlock }) {
  switch (block.kind) {
    case 'heading':
      return <h2>{block.text}</h2>;
    case 'text':
      return <p>{block.text}</p>;
    case 'list':
      return (
        <ul>
          {block.items.map((item) => (
            <li>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol>
          {block.items.map((item) => (
            <li>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      );
    case 'tip':
      return (
        <div class="tip">
          <Icon name="bulb" />
          <span>{block.text}</span>
        </div>
      );
    case 'notation':
      return (
        <div class="notation-table">
          {block.rows.map((row) => (
            <div>
              <code>{row.notation}</code>
              <span>{row.meaning}</span>
            </div>
          ))}
        </div>
      );
    case 'algorithm':
      return <Algorithm block={block} key={block.id} />;
  }
}

export function Learn({ topic, palette, back, onClose }: Props) {
  const [open, setOpen] = useState<string | null>(topic && LEARN_TOPICS.some((t) => t.id === topic) ? topic : null);
  const layer = useRef<HTMLDivElement>(null);
  const index = LEARN_TOPICS.findIndex((t) => t.id === open);
  const current = index >= 0 ? LEARN_TOPICS[index] : null;
  const following = index >= 0 ? LEARN_TOPICS[index + 1] : null;

  useEffect(() => {
    layer.current?.scrollTo(0, 0);
    layer.current?.focus();
  }, [open]);

  // While Learn is open the screen behind it cannot be reached, and closing puts the focus back where it was.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const behind = Array.from(layer.current?.parentElement?.children ?? []).filter((el) => el !== layer.current);
    for (const el of behind) el.setAttribute('inert', '');
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      for (const el of behind) el.removeAttribute('inert');
      opener?.focus?.();
    };
  }, []);

  return (
    <div class="layer" ref={layer} role="dialog" aria-modal="true" aria-label="Learn" tabIndex={-1} data-testid="learn-layer">
      <Palette.Provider value={palette ?? DEFAULT_PALETTE}>
      <div class="screen learn">
        <header class="bar">
          {current ? (
            <button class="btn ghost" onClick={() => setOpen(null)} data-testid="learn-topics">
              <Icon name="back" />
              Topics
            </button>
          ) : (
            <div class="bar-side" />
          )}
          <div class="bar-title">{current ? 'Learn ' + (index + 1) + ' of ' + LEARN_TOPICS.length : 'Learn'}</div>
          <button class="btn ghost" onClick={onClose} data-testid="learn-close">
            <Icon name="close" />
            Close
          </button>
        </header>

        {current ? (
          <article class="lesson" data-testid={'topic-' + current.id}>
            <h1>{current.title}</h1>
            <p class="lead">{current.summary}</p>
            {current.blocks.map((block) => (
              <Block block={block} />
            ))}
            {following ? (
              <button class="btn big" onClick={() => setOpen(following.id)} data-testid="learn-next">
                Next: {following.title}
                <Icon name="chevron" />
              </button>
            ) : (
              !back && (
                <button class="btn big primary" onClick={onClose}>
                  Back to the cube
                </button>
              )
            )}
          </article>
        ) : (
          <>
            <h1>How a 6x6 is solved by hand</h1>
            <p class="lead">The method the guide follows, the notation it uses, and how to handle a big cube. Read one in a spare minute.</p>
            <nav class="topics">
              {LEARN_TOPICS.map((t, k) => (
                <button class="topic" onClick={() => setOpen(t.id)} data-testid={'open-' + t.id}>
                  <span class="num">{k + 1}</span>
                  <span>
                    <b>{t.title}</b>
                    <small>{t.summary}</small>
                  </span>
                  <Icon name="chevron" />
                </button>
              ))}
            </nav>
          </>
        )}
        {back && (
          <footer class="actions sticky">
            <button class="btn primary big grow" onClick={onClose} data-testid="learn-back">
              <Icon name="back" />
              {back}
            </button>
          </footer>
        )}
      </div>
      </Palette.Provider>
    </div>
  );
}
