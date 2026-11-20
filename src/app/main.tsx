import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../styles/tokens.css';
import './app.css';
import { solvedState } from '../cube/geometry';
import { applyMoves, makeRng } from '../cube/moves';
import { randomState } from '../cube/random';
import { classifyCube, type FaceSample } from '../vision';
import type { SolveStep } from '../solver/index';
import { Capture } from './Capture';
import { CornerCapture, type Shot } from './CornerCapture';
import { Cube3D } from './Cube3D';
import { Learn } from './Learn';
import { Review } from './Review';
import { Solve } from './Solve';
import { SolverClient } from './solver-client';
import { clearItems, loadItems, loadSession, saveItem, saveSession } from './session';
import { DEFAULT_NAMES, DEFAULT_PALETTE, clearProgress, loadProgress, saveProgress, uniqueNames, type CubeData, type FacePhoto } from './model';
import { Icon, Pulse, useReducedMotion } from './ui';

type Screen = 'home' | 'capture' | 'corners' | 'review' | 'solve';

const HERO_STATE = randomState(makeRng(66));

function App() {
  const client = useMemo(() => new SolverClient(), []);
  const reduced = useReducedMotion();
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState<Screen>('home');
  const [data, setData] = useState<CubeData | null>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  const [steps, setSteps] = useState<SolveStep[]>([]);
  const [startAt, setStartAt] = useState(0);
  const [startMs, setStartMs] = useState(0);
  const [solving, setSolving] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(loadProgress);
  const [learn, setLearn] = useState<{ topic?: string; back?: string } | null>(null);
  const [scan, setScan] = useState<{ index: number; photos: (FacePhoto | null)[]; shots: Shot[] }>({ index: 0, photos: [], shots: [] });
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => window.scrollTo(0, 0), [screen]);

  const solve = async (cube: CubeData, resumeAt = 0, ms = 0): Promise<void> => {
    setError('');
    setSolving('Preparing the solver...');
    try {
      await client.ready;
      setSolving('Working out the steps...');
      const result = await client.solve(cube.state);
      const at = Math.min(resumeAt, result.steps.length);
      setSteps(result.steps);
      setStartAt(at);
      setStartMs(ms);
      saveProgress(cube, at, result.steps.length, ms);
      setData(cube);
      setScreen('solve');
    } catch (e) {
      setError('This cube cannot be solved as entered: ' + (e as Error).message);
    } finally {
      setSolving('');
    }
  };

  // After a reload, go back to where the person was.
  useEffect(() => {
    (async () => {
      const session = await loadSession();
      if (!session) return;
      const photos = session.hasPhotos ? await loadItems<FacePhoto>('photo', 6) : undefined;
      const cube = session.data ? ({ ...session.data, photos: photos && photos.every((p) => p) ? photos : undefined } as CubeData) : null;
      if (session.screen === 'review' && cube) {
        setData(cube);
        setScreen('review');
      } else if (session.screen === 'solve' && cube) {
        const progress = loadProgress();
        const same = progress && progress.state.length === cube.state.length && progress.state.every((v, i) => v === cube.state[i]);
        await solve(cube, same ? progress.step : 0, same ? (progress.ms ?? 0) : 0);
      } else if (session.screen === 'capture') {
        setScan({ index: session.captureIndex ?? 0, photos: await loadItems<FacePhoto>('photo', 6), shots: [] });
        setScreen('capture');
      } else if (session.screen === 'corners') {
        setScan({ index: session.captureIndex ?? 0, photos: [], shots: (await loadItems<Shot>('shot', 2)).filter((s): s is Shot => !!s) });
        setScreen('corners');
      }
    })()
      .catch(() => undefined)
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (booting) return;
    if (screen === 'home') void saveSession(null);
    else if ((screen === 'review' || screen === 'solve') && data) {
      const { photos, ...rest } = data;
      void saveSession({ screen, data: rest, hasPhotos: !!photos });
    }
  }, [booting, screen, data]);

  const home = (): void => {
    setSaved(loadProgress());
    setScreen('home');
    void clearItems('photo', 6);
    void clearItems('shot', 2);
  };

  const start = (to: 'capture' | 'corners', chosen: File[] | null = null): void => {
    setFiles(chosen);
    setScan({ index: 0, photos: [], shots: [] });
    setError('');
    void saveSession(chosen ? null : { screen: to, captureIndex: 0 });
    setScreen(to);
  };

  const fromPhotos = (photos: (FacePhoto | null)[]): void => {
    try {
      const result = classifyCube(photos.map((p) => (p as FacePhoto).sample) as FaceSample[]);
      photos.forEach((p, i) => void saveItem('photo', i, p));
      setData({ state: result.labels, palette: result.palette, names: uniqueNames(result.names), confidence: result.confidence, costs: result.costs, photos });
      setError('');
      setScreen('review');
    } catch (e) {
      setError('The photos could not be read: ' + (e as Error).message);
      home();
    }
  };

  const manual = (state: Uint8Array): void => {
    setData({ state, palette: DEFAULT_PALETTE, names: DEFAULT_NAMES });
    setError('');
    setScreen('review');
  };

  // In a solve, Learn's example cubes wear this cube's colours, on the sides they will end up on.
  const sideColours = useMemo(() => {
    if (screen !== 'solve' || !data || !steps.length) return undefined;
    const end = applyMoves(data.state, steps.map((s) => s.move));
    return [0, 1, 2, 3, 4, 5].map((f) => data.palette[end[f * 36] as number] as string);
  }, [screen, data, steps]);
  const layer = learn && <Learn topic={learn.topic} back={learn.back} palette={sideColours} onClose={() => setLearn(null)} />;

  if (booting)
    return (
      <div class="screen home">
        {solving && (
          <p class="busy-line" style={{ margin: 'auto' }} role="status">
            <Pulse />
            Picking up where you left off...
          </p>
        )}
      </div>
    );

  if (screen === 'capture')
    return (
      <Capture
        files={files}
        initial={scan}
        onProgress={(index, face, photo) => {
          if (files) return;
          if (photo) void saveItem('photo', face, photo);
          void saveSession({ screen: 'capture', captureIndex: index });
        }}
        onDone={fromPhotos}
        onCancel={home}
      />
    );
  if (screen === 'corners')
    return (
      <CornerCapture
        initial={scan.shots}
        onProgress={(index, shot) => {
          if (shot) void saveItem('shot', index - 1, shot);
          void saveSession({ screen: 'corners', captureIndex: index });
        }}
        onDone={fromPhotos}
        onCancel={home}
      />
    );
  if (screen === 'review' && data)
    return <Review data={data} client={client} solving={solving} solveError={error} onChange={(state) => setData({ ...data, state })} onSolve={() => void solve(data)} onBack={home} />;
  if (screen === 'solve' && data)
    return (
      <>
        <Solve
          data={data}
          steps={steps}
          startAt={startAt}
          startMs={startMs}
          onStep={(k, ms) => saveProgress(data, k, steps.length, ms)}
          onExit={() => {
            setSaved(loadProgress());
            setScreen('review');
          }}
          onAgain={() => {
            clearProgress();
            home();
          }}
          onLearn={(topic, step) => setLearn({ topic, back: step === undefined ? undefined : step < steps.length ? 'Back to step ' + (step + 1) : 'Back to your cube' })}
        />
        {layer}
      </>
    );

  const unfinished = saved && saved.step < saved.total ? saved : null;

  return (
    <>
    <div class="screen home">
      <header class="bar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <i class={i === 2 || i === 4 || i === 6 ? 'hot' : ''} />
            ))}
          </span>
          6x6 Solver
        </div>
        <button class="btn ghost" onClick={() => setLearn({})} data-testid="learn">
          <Icon name="book" />
          Learn
        </button>
      </header>

      <section class="hero">
        <div class="hero-stage">
          <Cube3D
            class="hero-cube"
            interactive={false}
            labels={false}
            onReady={(v) => {
              v.setState(HERO_STATE, DEFAULT_PALETTE);
              v.spin(reduced ? 0 : 0.22);
            }}
          />
        </div>
        <h1>Solve your 6x6, one turn at a time</h1>
        <p class="lead">Point your phone at the cube. The app reads the colours, then shows every turn in 3D, at your pace.</p>
      </section>

      <section class="tray ways" aria-label="Start">
        {unfinished && (
          <button class="way resume" data-testid="resume" disabled={!!solving} onClick={() => void solve({ state: Uint8Array.from(unfinished.state), palette: unfinished.palette, names: unfinished.names }, unfinished.step, unfinished.ms ?? 0)}>
            {solving ? <Pulse /> : <Icon name="play" />}
            <span>
              {solving || 'Carry on with your solve'}
              {!solving && (
                <small>
                  Step {unfinished.step + 1} of {unfinished.total}
                </small>
              )}
            </span>
          </button>
        )}
        <button class="way main" data-testid="scan" onClick={() => start('capture')}>
          <Icon name="camera" />
          <span>
            Scan with the camera
            <small>Six sides. It takes each photo by itself.</small>
          </span>
        </button>
        <button class="way" data-testid="corners" onClick={() => start('corners')}>
          <Icon name="corner" />
          <span>
            Quick scan
            <small>Two corner photos</small>
          </span>
        </button>
        <button class="way" onClick={() => picker.current?.click()}>
          <Icon name="photos" />
          <span>
            Use photos
            <small>Six I already have</small>
          </span>
        </button>
        <button class="way" data-testid="manual" onClick={() => manual(new Uint8Array(216).fill(255))}>
          <Icon name="grid" />
          <span>
            By hand
            <small>Tap in the colours</small>
          </span>
        </button>
      </section>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="files"
        onChange={(e) => {
          const list = Array.from((e.target as HTMLInputElement).files ?? []);
          (e.target as HTMLInputElement).value = '';
          if (list.length !== 6) {
            setError('Choose exactly six photos, in this order: front, right, back, left, top, bottom. You picked ' + list.length + '.');
            return;
          }
          start('capture', list);
        }}
      />
      {error && (
        <p class="note bad" role="alert">
          {error}
        </p>
      )}

      <ol class="how">
        <li>
          <span>
            <b>Scan.</b> Hold each side up to the camera. The app finds the cube and takes the photo when it is lined up and still, then shows you what it read.
          </span>
        </li>
        <li>
          <span>
            <b>Check.</b> Fix any sticker it got wrong. It tells you if the colours cannot be a real cube, and which pieces look wrong.
          </span>
        </li>
        <li>
          <span>
            <b>Solve.</b> Each step shows which layers to turn and which way. Go back whenever you need to.
          </span>
        </li>
      </ol>
      <p class="fine">Photos you already have go in this order: front, right, back, left (each with the top side up), then top (back side up), then bottom (front side up).</p>
      <div class="home-foot">
        <button class="link" data-testid="demo" onClick={() => manual(randomState(makeRng((Date.now() & 0xffffff) + 1)))}>
          Try a random scramble
        </button>
        <button class="link" onClick={() => manual(solvedState())}>
          Start from a solved cube
        </button>
        {saved && (
          <button
            class="link"
            onClick={() => {
              clearProgress();
              setSaved(null);
            }}
          >
            Forget saved solve
          </button>
        )}
      </div>
      <p class="fine">Everything runs in this browser. Photos never leave your device.</p>
    </div>
    {layer}
    </>
  );
}

render(<App />, document.getElementById('app') as HTMLElement);

// Installed to the home screen or not, the built app keeps working with no network after the first visit.
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
