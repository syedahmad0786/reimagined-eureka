import { useEffect, useRef, useState } from 'preact/hooks';
import {
  CameraCapture,
  OUTLINE_SURE,
  QuadEditor,
  ReadoutView,
  classifyPartial,
  detectFaceQuad,
  imageDataToCanvas,
  loadImageFile,
  readingFor,
  sampleFace,
  type CameraStatus,
  type FaceSample,
  type Quad,
} from '../vision';
import type { CubeView } from '../viewer';
import { Cube3D } from './Cube3D';
import { CAPTURE_STEPS, type FacePhoto } from './model';
import { Icon, Pulse } from './ui';

interface Props {
  /** Photos chosen up front, in capture order (front, right, back, left, top, bottom). */
  files: File[] | null;
  /** A scan that was under way before a reload. */
  initial?: { index: number; photos: (FacePhoto | null)[] };
  /** Called when a photo is accepted: the next photo number, the face just stored and its photo. */
  onProgress?: (index: number, face: number, photo: FacePhoto | null) => void;
  onDone: (photos: (FacePhoto | null)[]) => void;
  onCancel: () => void;
}

interface Frame {
  image: ImageData;
  quad: Quad;
  /** Sticker colours read by the camera over the steady frames; dropped once the outline is moved by hand. */
  sample: FaceSample | null;
  /** The outline finder was not sure; the user is asked to check the corners. */
  unsure: boolean;
  auto: boolean;
}

export function css(rgb: Float32Array, i: number): string {
  return 'rgb(' + Math.round(rgb[i * 3] as number) + ',' + Math.round(rgb[i * 3 + 1] as number) + ',' + Math.round(rgb[i * 3 + 2] as number) + ')';
}

export function Capture({ files, initial, onProgress, onDone, onCancel }: Props) {
  const [index, setIndex] = useState(Math.min(initial?.index ?? 0, CAPTURE_STEPS.length - 1));
  const [frame, setFrame] = useState<Frame | null>(null);
  const [grips, setGrips] = useState(false);
  const [status, setStatus] = useState<CameraStatus | null>(null);
  const [unsureStickers, setUnsureStickers] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [, redraw] = useState(0);
  const photos = useRef<(FacePhoto | null)[]>(Array.from({ length: 6 }, (_, f) => initial?.photos[f] ?? null));
  const view = useRef<CubeView | null>(null);
  const camHost = useRef<HTMLDivElement>(null);
  const editHost = useRef<HTMLDivElement>(null);
  const readHost = useRef<HTMLDivElement>(null);
  const quad = useRef<Quad | null>(null);
  const step = CAPTURE_STEPS[index] as (typeof CAPTURE_STEPS)[number];

  // The little 3D cube shows which side to photograph and fills in with what has been scanned.
  const paintGuide = (animate: boolean): void => {
    const v = view.current;
    if (!v) return;
    const state = new Uint8Array(216).fill(255);
    const palette: string[] = new Array<string>(216).fill('#544858');
    photos.current.forEach((p, face) => {
      if (!p) return;
      for (let i = 0; i < 36; i++) {
        state[face * 36 + i] = face * 36 + i;
        palette[face * 36 + i] = css(p.sample.rgb, i);
      }
    });
    v.setState(state, palette);
    v.highlightFace(step.face, { upToward: step.up });
    void v.setPose({ front: step.face, up: step.up }, animate ? 900 : 0);
  };

  useEffect(() => paintGuide(index > 0), [index]);

  // Camera, or the next pre-chosen file.
  useEffect(() => {
    if (frame) return;
    let alive = true;
    const file = files?.[index];
    if (file) {
      setBusy(true);
      loadImageFile(file)
        .then((image) => {
          if (!alive) return;
          const found = detectFaceQuad(image);
          setGrips(found.confidence < OUTLINE_SURE);
          setFrame({ image, quad: found.quad, sample: null, unsure: found.confidence < OUTLINE_SURE, auto: false });
        })
        .catch((e: Error) => alive && setError(e.message))
        .finally(() => alive && setBusy(false));
      return () => {
        alive = false;
      };
    }
    setStatus(null);
    const cam = new CameraCapture(camHost.current as HTMLDivElement, {
      mode: 'face',
      auto: true,
      avoid: photos.current.filter((p, f) => p && f !== step.face).map((p) => (p as FacePhoto).sample),
      onStatus: (s) => alive && setStatus(s),
    });
    const loop = (): void => {
      cam
        .capture()
        .then((f) => {
          if (!alive) return;
          const unsure = f.confidence < OUTLINE_SURE;
          setGrips(unsure);
          setFrame({ image: f.image, quad: f.quad, sample: f.samples?.[0] ?? null, unsure, auto: f.auto });
        })
        .catch((e: Error) => {
          if (!alive) return;
          if (!/superseded|closed/.test(e.message)) setError(e.message);
          loop();
        });
    };
    void cam.start();
    loop();
    return () => {
      alive = false;
      cam.destroy();
    };
  }, [index, frame === null]);

  const sampleNow = (f: Frame): FaceSample => (f.sample && quad.current === f.quad ? f.sample : sampleFace(f.image, quad.current as Quad));

  // What was read, drawn on the photo; or the corner grips when the outline needs a hand.
  useEffect(() => {
    if (!frame) return;
    if (!quad.current) quad.current = frame.quad;
    if (grips) {
      const editor = new QuadEditor(editHost.current as HTMLDivElement, imageDataToCanvas(frame.image), quad.current, (q) => {
        quad.current = q;
      });
      return () => editor.destroy();
    }
    const readout = new ReadoutView(readHost.current as HTMLDivElement, {});
    const slots = photos.current.map((p, f) => (f === step.face ? null : (p?.sample ?? null)));
    slots[step.face] = sampleNow(frame);
    readout.setReading(readingFor(frame.image, [{ face: step.face, quad: quad.current }], classifyPartial(slots)));
    setUnsureStickers(readout.unsureCount());
    return () => readout.destroy();
  }, [frame, grips]);

  const clear = (): void => {
    quad.current = null;
    setFrame(null);
    setGrips(false);
    setError('');
  };

  const accept = (): void => {
    if (!frame || !quad.current) return;
    const photo: FacePhoto = { image: frame.image, quad: quad.current, sample: sampleNow(frame) };
    photos.current[step.face] = photo;
    clear();
    if (index === CAPTURE_STEPS.length - 1) onDone(photos.current);
    else {
      onProgress?.(index + 1, step.face, photo);
      setIndex(index + 1);
    }
  };

  const back = (): void => {
    if (frame) clear();
    else if (index > 0) {
      onProgress?.(index - 1, step.face, null);
      setIndex(index - 1);
    } else onCancel();
  };

  const steady = status?.state === 'steady' || status?.state === 'captured';

  return (
    <div class="screen capture">
      <header class="bar">
        <button class="btn ghost icon" onClick={back} aria-label="Back">
          <Icon name="back" />
        </button>
        <div class="bar-title">
          {step.title} side
          <small>Photo {index + 1} of 6</small>
        </div>
        <div class="face-strip" aria-hidden="true">
          {CAPTURE_STEPS.map((s, i) => {
            const p = photos.current[s.face];
            return <span class={'mini' + (i === index ? ' now' : '')}>{Array.from({ length: 36 }, (_, k) => <i style={p && i !== index ? { background: css(p.sample.rgb, k) } : undefined} />)}</span>;
          })}
        </div>
      </header>

      <section class="guide">
        <Cube3D
          class="guide-cube"
          interactive={false}
          labels={false}
          onReady={(v) => {
            view.current = v;
            paintGuide(false);
          }}
        />
        <p class="guide-text" aria-live="polite">
          {!frame && (
            <>
              {step.how}{' '}
              <span class="dim">{status?.state === 'no-camera' ? status.hint : 'Hold it straight on, filling the square. The photo is taken for you.'}</span>
            </>
          )}
          {frame && grips && 'Drag the four corners onto the corners of the sticker area, so the grid sits on the stickers.'}
          {frame && !grips && (
            <>
              <b>{unsureStickers ? unsureStickers + (unsureStickers === 1 ? ' sticker is' : ' stickers are') + ' not certain' : 'Read all 36 stickers'}</b>
              Each chip shows the colour that was read. If they match your cube, carry on. You can still fix single stickers later.
            </>
          )}
        </p>
      </section>

      {error && (
        <p class="note bad" role="alert">
          {error}
        </p>
      )}

      {!frame && (
        <div class={'cam-wrap' + (status?.state === 'no-camera' ? ' none' : '')}>
          <div class="cam-host" ref={camHost} />
          {busy && (
            <p class="cam-status" role="status">
              <Pulse />
              Opening photo...
            </p>
          )}
          {status && status.state !== 'no-camera' && status.state !== 'starting' && (
            <p class={'cam-status' + (steady ? ' steady' : '')} role="status" data-testid="cam-status" data-state={status.state}>
              {steady && (
                <svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
                  <circle class="ring-track" cx="18" cy="18" r="14" />
                  <circle class="ring-fill" cx="18" cy="18" r="14" stroke-dasharray="88" stroke-dashoffset={88 * (1 - status.progress)} />
                </svg>
              )}
              {status.hint}
            </p>
          )}
        </div>
      )}

      {frame && (
        <>
          {frame.unsure && grips && (
            <p class="note fix" data-testid="unsure">
              The app is not sure it found this side. Check the four corners before you carry on.
            </p>
          )}
          <div class="read-wrap">{grips ? <div class="edit-host" ref={editHost} key="edit" /> : <div class="read-host" ref={readHost} key="read" data-testid="readout" />}</div>
          <button class="link" onClick={() => setGrips(!grips)} data-testid="toggle-grips">
            {grips ? 'Show what was read' : 'The grid is off? Move its corners'}
          </button>
          <footer class="actions sticky">
            <button class="btn big" onClick={clear} data-testid="retake">
              Retake
            </button>
            <button class="btn primary big grow" onClick={accept} data-testid="use-photo">
              {index === 5 ? 'Looks right, read the cube' : 'Looks right, next side'}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
