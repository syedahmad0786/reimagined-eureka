import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { NN, N } from '../cube/geometry';
import { colourCounts } from '../cube/scheme';
import { validateState, type Suggestion } from '../cube/validate';
import { imageDataToCanvas, rectifyFace } from '../vision';
import { CAPTURE_STEPS, FACE_TITLES, NEIGHBOURS, type CubeData } from './model';
import type { SolverClient } from './solver-client';
import { Icon, Pulse } from './ui';

interface Props {
  data: CubeData;
  client: SolverClient;
  solving: string;
  solveError: string;
  onChange: (state: Uint8Array) => void;
  onSolve: () => void;
  onBack: () => void;
}

const UNKNOWN = '#544858';
const FACE_ORDER = CAPTURE_STEPS.map((s) => s.face);

export function Review({ data, client, solving, solveError, onChange, onSolve, onBack }: Props) {
  const { state, palette, names } = data;
  const [face, setFace] = useState(FACE_ORDER[0] as number);
  const [colour, setColour] = useState(0);
  const [showPhoto, setShowPhoto] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const undo = useRef<Uint8Array[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const painting = useRef(false);
  const [allNotes, setAllNotes] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const validation = useMemo(() => validateState(state, names), [state]);
  const counts = useMemo(() => colourCounts(state), [state]);
  // Unset stickers are grey already; only stickers that contradict each other get the red outline.
  const suspects = useMemo(() => new Set(validation.problems.filter((p) => p.kind !== 'unknown').flatMap((p) => p.facelets)), [validation]);

  // Ask the worker for the smallest repair whenever the state is complete but not valid.
  useEffect(() => {
    setSuggestions([]);
    if (validation.ok || validation.problems.some((p) => p.kind === 'unknown')) return;
    let alive = true;
    const timer = setTimeout(() => {
      client
        .suggest(state, names, data.costs)
        .then((s) => alive && setSuggestions(s))
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [state]);

  const photoUrl = useMemo(() => {
    const p = data.photos?.[face];
    if (!p) return '';
    const r = rectifyFace(p.image, p.quad, 360);
    return imageDataToCanvas(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height)).toDataURL('image/jpeg', 0.85);
  }, [face, data.photos]);

  const commit = (next: Uint8Array): void => {
    undo.current.push(state);
    if (undo.current.length > 100) undo.current.shift();
    setUndoCount(undo.current.length);
    onChange(next);
  };

  const paint = (i: number): void => {
    if (state[i] === colour) return;
    const next = state.slice();
    next[i] = colour;
    commit(next);
  };

  const onPointer = (e: PointerEvent): void => {
    if (e.type === 'pointerdown') painting.current = true;
    if (!painting.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const i = el?.dataset?.i;
    if (i !== undefined) paint(Number(i));
  };

  const apply = (s: Suggestion): void => {
    const next = state.slice();
    for (const c of s.changes) next[c.facelet] = c.colour;
    commit(next);
  };

  const fillFace = (): void => {
    const next = state.slice();
    next.fill(colour, face * NN, face * NN + NN);
    commit(next);
  };

  const around = NEIGHBOURS[face] as number[];
  const hasUnknown = validation.problems.some((p) => p.kind === 'unknown');

  // What is wrong and how to mend it sit straight under the faces, the first problem and the likeliest fix first.
  const problemNote = (p: (typeof validation.problems)[number]) => (
    <div class="note bad" data-testid="problem">
      <p>{p.message}</p>
      {p.facelets.length > 0 && !hasUnknown && (
        <button class="btn small" onClick={() => setFace(Math.floor((p.facelets.find((f) => Math.floor(f / NN) !== face) ?? (p.facelets[0] as number)) / NN))}>
          Show {p.facelets.length === 1 ? 'it' : 'them'} (marked with !)
        </button>
      )}
      {hasUnknown && (
        <button class="btn small" onClick={() => setFace(Math.floor((p.facelets[0] as number) / NN))}>
          Go to the first one
        </button>
      )}
    </div>
  );
  const several = suggestions.length > 1 && suggestions.every((s) => s.solves);
  const fixNote = (s: Suggestion) => (
    <div class="note fix" data-testid="suggestion">
      <p>
        <b>{s.solves ? 'Likely fix: ' : 'Would help: '}</b>
        {s.description}
        {several && ' Compare with your cube first: each fix on its own gives a real cube.'}
      </p>
      <div class="row">
        {s.changes[0] && (
          <button class="btn small" onClick={() => setFace(Math.floor((s.changes[0] as Suggestion['changes'][number]).facelet / NN))}>
            Show
          </button>
        )}
        <button class="btn small" onClick={() => apply(s)} data-testid="apply">
          Apply
        </button>
      </div>
    </div>
  );
  const [firstProblem, ...otherProblems] = validation.problems;
  const notes = firstProblem ? [problemNote(firstProblem), ...suggestions.map(fixNote), ...otherProblems.map(problemNote)] : [];

  return (
    <div class="screen review">
      <header class="bar">
        <button class="btn ghost icon" onClick={() => (undoCount > 0 || data.photos ? setLeaving(true) : onBack())} aria-label="Back to the start" data-testid="review-back">
          <Icon name="back" />
        </button>
        <div class="bar-title">
          Check the colours
          <small>{FACE_TITLES[face]} side</small>
        </div>
        <button
          class="btn ghost"
          disabled={!undoCount}
          onClick={() => {
            const prev = undo.current.pop();
            setUndoCount(undo.current.length);
            if (prev) onChange(prev);
          }}
        >
          <Icon name="undo" />
          Undo
        </button>
      </header>

      <nav class="faces" aria-label="Faces">
        {FACE_ORDER.map((f) => {
          let bad = false;
          for (let i = f * NN; i < f * NN + NN; i++) if (suspects.has(i)) bad = true;
          return (
            <button class={'face-tab' + (f === face ? ' on' : '') + (bad ? ' bad' : '')} onClick={() => setFace(f)} aria-pressed={f === face} data-testid={'face-' + f}>
              <span class="thumb">
                {Array.from({ length: NN }, (_, i) => (
                  <i style={{ background: palette[state[f * NN + i] as number] ?? UNKNOWN }} />
                ))}
              </span>
              <span>{FACE_TITLES[f]}</span>
            </button>
          );
        })}
      </nav>

      <section class="checks" aria-live="polite">
        {validation.ok ? (
          <p class="note ok" data-testid="valid">
            <span>
              <b>This is a real cube.</b> 36 stickers of each colour, and the corners, edges and centres all fit together.
            </span>
          </p>
        ) : (
          <>
            {notes.slice(0, allNotes ? notes.length : 2)}
            {notes.length > 2 && (
              <button class="link" onClick={() => setAllNotes(!allNotes)} data-testid="more-notes">
                {allNotes ? 'Show fewer' : 'Show ' + (notes.length - 2) + ' more'}
              </button>
            )}
          </>
        )}
        {solveError && (
          <p class="note bad" role="alert">
            {solveError}
          </p>
        )}
      </section>

      <section class="board">
        <div class="edge-label">{FACE_TITLES[around[0] as number]} side here</div>
        <div class="board-row">
          <div class="edge-label side">{FACE_TITLES[around[3] as number]}</div>
          {showPhoto && photoUrl ? (
            <img class="grid photo" src={photoUrl} alt={'Photo of the ' + FACE_TITLES[face] + ' face'} />
          ) : (
            <div
              class="grid"
              role="grid"
              aria-label={FACE_TITLES[face] + ' face'}
              onPointerDown={onPointer}
              onPointerMove={onPointer}
              onPointerUp={() => (painting.current = false)}
              onPointerCancel={() => (painting.current = false)}
              onPointerLeave={() => (painting.current = false)}
            >
              {Array.from({ length: NN }, (_, k) => {
                const i = face * NN + k;
                const c = state[i] as number;
                const low = data.confidence && (data.confidence[i] as number) < 0.5;
                return (
                  <button
                    class={'cell' + (suspects.has(i) ? ' bad' : '') + (low ? ' low' : '')}
                    style={{ background: palette[c] ?? UNKNOWN }}
                    data-i={i}
                    data-c={c}
                    aria-label={'Row ' + (Math.floor(k / N) + 1) + ' column ' + ((k % N) + 1) + ': ' + (names[c] ?? 'not set')}
                    onClick={() => paint(i)}
                  />
                );
              })}
            </div>
          )}
          <div class="edge-label side">{FACE_TITLES[around[1] as number]}</div>
        </div>
        <div class="edge-label">{FACE_TITLES[around[2] as number]} side here</div>
      </section>

      <section class="tray palette" aria-label="Colour to paint with">
        {palette.map((p, c) => (
          <button class={'swatch' + (c === colour ? ' on' : '')} style={{ background: p }} onClick={() => setColour(c)} aria-pressed={c === colour} aria-label={names[c] + ', ' + counts[c] + ' of 36'} data-testid={'swatch-' + c}>
            <span class={counts[c] === 36 ? 'ok' : 'off'}>{counts[c]}</span>
          </button>
        ))}
      </section>
      <div class="tools">
        <span class="hint">
          Pick a colour, then tap or drag over stickers. Painting with <b>{names[colour]}</b>.
        </span>
        {data.photos?.[face] && (
          <button class="btn small" onClick={() => setShowPhoto(!showPhoto)} aria-pressed={showPhoto}>
            {showPhoto ? 'Show grid' : 'Show photo'}
          </button>
        )}
        {!data.photos && (
          <button class="btn small" onClick={fillFace}>
            Fill face
          </button>
        )}
      </div>

      <footer class="actions sticky">
        <button class="btn primary grow big" disabled={!validation.ok || !!solving} onClick={onSolve} data-testid="solve">
          {solving && <Pulse />}
          {solving || (validation.ok ? 'Solve this cube' : hasUnknown ? 'Colour every sticker to solve' : 'Fix the marked stickers to solve')}
        </button>
      </footer>
      {leaving && (
        <div class="sheet-back" onClick={() => setLeaving(false)}>
          <div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="leave-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="leave-title">Leave this cube?</h2>
            <p>{data.photos ? 'The scan and any colours you fixed will be thrown away.' : 'The colours you entered will be thrown away.'}</p>
            <div class="actions">
              <button class="btn big grow" onClick={onBack} data-testid="leave">
                Throw it away
              </button>
              <button class="btn primary big grow" onClick={() => setLeaving(false)} data-testid="stay">
                Keep checking
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
