import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../styles/tokens.css';
import './app.css';
import { solvedState } from '../cube/geometry';
import { makeRng } from '../cube/moves';
import { randomState } from '../cube/random';
import { classifyCube, type FaceSample } from '../vision';
import type { SolveStep } from '../solver/index';
import { Capture } from './Capture';
import { CornerCapture } from './CornerCapture';
import { Review } from './Review';
import { Solve } from './Solve';
import { SolverClient } from './solver-client';
import { DEFAULT_NAMES, DEFAULT_PALETTE, clearProgress, loadProgress, saveProgress, uniqueNames, type CubeData, type FacePhoto } from './model';

type Screen = 'home' | 'capture' | 'corners' | 'review' | 'solve';

function App() {
  const client = useMemo(() => new SolverClient(), []);
  const [screen, setScreen] = useState<Screen>('home');
  const [data, setData] = useState<CubeData | null>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  const [steps, setSteps] = useState<SolveStep[]>([]);
  const [startAt, setStartAt] = useState(0);
  const [solving, setSolving] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(loadProgress);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => window.scrollTo(0, 0), [screen]);

  const solve = async (cube: CubeData, resumeAt = 0): Promise<void> => {
    setError('');
    setSolving('Preparing the solver...');
    try {
      await client.ready;
      setSolving('Working out the steps...');
      const result = await client.solve(cube.state);
      setSteps(result.steps);
      setStartAt(Math.min(resumeAt, result.steps.length));
      saveProgress(cube, Math.min(resumeAt, result.steps.length), result.steps.length);
      setData(cube);
      setScreen('solve');
    } catch (e) {
      setError('This cube cannot be solved as entered: ' + (e as Error).message);
    } finally {
      setSolving('');
    }
  };

  const fromPhotos = (photos: (FacePhoto | null)[]): void => {
    try {
      const result = classifyCube(photos.map((p) => (p as FacePhoto).sample) as FaceSample[]);
      setData({ state: result.labels, palette: result.palette, names: uniqueNames(result.names), confidence: result.confidence, costs: result.costs, photos });
      setError('');
      setScreen('review');
    } catch (e) {
      setError('The photos could not be read: ' + (e as Error).message);
      setScreen('home');
    }
  };

  const manual = (state: Uint8Array): void => {
    setData({ state, palette: DEFAULT_PALETTE, names: DEFAULT_NAMES });
    setError('');
    setScreen('review');
  };

  if (screen === 'capture') return <Capture files={files} onDone={fromPhotos} onCancel={() => setScreen('home')} />;
  if (screen === 'corners') return <CornerCapture onDone={fromPhotos} onCancel={() => setScreen('home')} />;
  if (screen === 'review' && data)
    return <Review data={data} client={client} solving={solving} solveError={error} onChange={(state) => setData({ ...data, state })} onSolve={() => void solve(data)} onBack={() => setScreen('home')} />;
  if (screen === 'solve' && data)
    return (
      <Solve
        data={data}
        steps={steps}
        startAt={startAt}
        onStep={(k) => saveProgress(data, k, steps.length)}
        onExit={() => {
          setSaved(loadProgress());
          setScreen('review');
        }}
      />
    );

  return (
    <div class="screen home">
      <h1>6x6 cube solver</h1>
      <p class="lead">Photograph the six sides of your scrambled 6x6x6 cube, check the colours, then follow the 3D guide one turn at a time.</p>

      <button
        class="btn primary big"
        data-testid="scan"
        onClick={() => {
          setFiles(null);
          setScreen('capture');
        }}
      >
        Scan with the camera
      </button>
      <button class="btn big" data-testid="corners" onClick={() => setScreen('corners')}>
        Quick scan: two corner photos
      </button>
      <button class="btn big" onClick={() => picker.current?.click()}>
        Use six photos I already have
      </button>
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
          setError('');
          setFiles(list);
          setScreen('capture');
        }}
      />
      <p class="fine">Existing photos go in this order: front, right, back, left (each with the top side up), then top (back side up), then bottom (front side up).</p>
      <button class="btn big" data-testid="manual" onClick={() => manual(new Uint8Array(216).fill(255))}>
        Enter the colours by hand
      </button>
      {saved && saved.step < saved.total && (
        <button
          class="btn big"
          data-testid="resume"
          disabled={!!solving}
          onClick={() => void solve({ state: Uint8Array.from(saved.state), palette: saved.palette, names: saved.names }, saved.step)}
        >
          {solving || 'Resume last solve (step ' + (saved.step + 1) + ' of ' + saved.total + ')'}
        </button>
      )}
      {error && (
        <p class="note bad" role="alert">
          {error}
        </p>
      )}

      <ol class="how">
        <li>
          <b>Six photos.</b> One per side, straight on. The app shows how to turn the cube between photos. The quick scan needs only two photos, taken from opposite corners, but you check a larger outline.
        </li>
        <li>
          <b>Check.</b> Fix any sticker the camera got wrong. The app tells you if the colours cannot be a real cube, and which pieces look wrong.
        </li>
        <li>
          <b>Solve.</b> Each step shows which layers to turn and which way. Go at your own pace.
        </li>
      </ol>
      <div class="row">
        <button class="btn small" data-testid="demo" onClick={() => manual(randomState(makeRng((Date.now() & 0xffffff) + 1)))}>
          Try a random scramble
        </button>
        <button class="btn small" onClick={() => manual(solvedState())}>
          Start from a solved cube
        </button>
        {saved && (
          <button
            class="btn small"
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
  );
}

render(<App />, document.getElementById('app') as HTMLElement);
