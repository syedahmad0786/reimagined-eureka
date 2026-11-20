import { useEffect, useRef, useState } from 'preact/hooks';
import { CameraCapture, QuadEditor, detectFaceQuad, imageDataToCanvas, loadImageFile, locateFaceNear, sampleFace, type Quad } from '../vision';
import type { CubeView } from '../viewer';
import { Cube3D } from './Cube3D';
import { CAPTURE_STEPS, type FacePhoto } from './model';

interface Props {
  /** Photos chosen up front, in capture order (front, right, back, left, top, bottom). */
  files: File[] | null;
  onDone: (photos: (FacePhoto | null)[]) => void;
  onCancel: () => void;
}

interface Frame {
  image: ImageData;
  quad: Quad;
  /** The outline finder was not sure; the user is asked to check the corners. */
  unsure: boolean;
}

const SURE = 0.9;

function css(rgb: Float32Array, i: number): string {
  return 'rgb(' + Math.round(rgb[i * 3] as number) + ',' + Math.round(rgb[i * 3 + 1] as number) + ',' + Math.round(rgb[i * 3 + 2] as number) + ')';
}

export function Capture({ files, onDone, onCancel }: Props) {
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const photos = useRef<(FacePhoto | null)[]>([null, null, null, null, null, null]);
  const view = useRef<CubeView | null>(null);
  const camHost = useRef<HTMLDivElement>(null);
  const editHost = useRef<HTMLDivElement>(null);
  const quad = useRef<Quad | null>(null);
  const step = CAPTURE_STEPS[index] as (typeof CAPTURE_STEPS)[number];

  // The little 3D cube shows which side to photograph and fills in with what has been scanned.
  const paintGuide = (animate: boolean): void => {
    const v = view.current;
    if (!v) return;
    const state = new Uint8Array(216).fill(255);
    const palette: string[] = new Array<string>(216).fill('#4a5361');
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
          setFrame({ image, quad: found.quad, unsure: found.confidence < SURE });
        })
        .catch((e: Error) => alive && setError(e.message))
        .finally(() => alive && setBusy(false));
      return () => {
        alive = false;
      };
    }
    const cam = new CameraCapture(camHost.current as HTMLDivElement, {});
    const loop = (): void => {
      cam
        .capture()
        .then((f) => {
          if (!alive) return;
          // A shutter frame carries the on-screen guide square (a picked file its detected outline);
          // look for the face near it and keep which way is up.
          const found = locateFaceNear(f.image, f.quad);
          setFrame({ image: f.image, quad: found.quad, unsure: found.confidence < SURE });
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

  // Outline editor for the photo just taken.
  useEffect(() => {
    if (!frame) return;
    quad.current = frame.quad;
    const refresh = (): void => {
      const s = sampleFace(frame.image, quad.current as Quad);
      setPreview(Array.from({ length: 36 }, (_, i) => css(s.rgb, i)));
    };
    let timer = 0;
    const editor = new QuadEditor(editHost.current as HTMLDivElement, imageDataToCanvas(frame.image), frame.quad, (q) => {
      quad.current = q;
      clearTimeout(timer);
      timer = window.setTimeout(refresh, 80);
    });
    refresh();
    return () => {
      clearTimeout(timer);
      editor.destroy();
    };
  }, [frame]);

  const accept = (): void => {
    if (!frame || !quad.current) return;
    photos.current[step.face] = { image: frame.image, quad: quad.current, sample: sampleFace(frame.image, quad.current) };
    setFrame(null);
    setPreview(null);
    setError('');
    if (index === CAPTURE_STEPS.length - 1) onDone(photos.current);
    else setIndex(index + 1);
  };

  const retake = (): void => {
    setFrame(null);
    setPreview(null);
    setError('');
  };

  const back = (): void => {
    if (frame) retake();
    else if (index > 0) setIndex(index - 1);
    else onCancel();
  };

  return (
    <div class="screen capture">
      <header class="bar">
        <button class="btn ghost" onClick={back} aria-label="Back">
          Back
        </button>
        <div class="bar-title">
          Photo {index + 1} of 6: <b>{step.title.toLowerCase()}</b>
        </div>
        <div class="dots" aria-hidden="true">
          {CAPTURE_STEPS.map((_, i) => (
            <i class={i < index ? 'done' : i === index ? 'now' : ''} />
          ))}
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
        <p class="guide-text">
          {frame ? 'Drag the four corner grips until the grid sits on the stickers. The small grid shows what will be read.' : step.how}
          {!frame && <span class="guide-hint"> Fill the square with this one side, straight on: if you can see any other side of the cube, tilt until you cannot.</span>}
        </p>
      </section>

      {error && (
        <p class="note bad" role="alert">
          {error}
        </p>
      )}

      {!frame && <div class="cam-host" ref={camHost}>{busy && <p class="note">Opening photo...</p>}</div>}

      {frame && (
        <>
          {frame.unsure && (
            <p class="note fix" data-testid="unsure">
              The app is not sure it found this side. Check that the four corners sit on the corners of the sticker area before you continue.
            </p>
          )}
          <div class="edit-host" ref={editHost} />
          <footer class="actions">
            <div class="mini-grid" aria-label="Colours read from this photo">
              {(preview ?? []).map((c) => (
                <i style={{ background: c }} />
              ))}
            </div>
            <button class="btn" onClick={retake}>
              Retake
            </button>
            <button class="btn primary grow" onClick={accept} data-testid="use-photo">
              {index === 5 ? 'Use photo and read colours' : 'Use photo'}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
