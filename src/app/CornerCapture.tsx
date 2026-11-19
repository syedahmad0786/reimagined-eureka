/**
 * Quick scan: two photos, each of three sides around a corner, taken from opposite corners.
 * The outline of each shot (seven points) is always shown for checking. The second photo may be
 * taken with any of its three sides on top: the arrangement that gives a real cube is chosen.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { D, L, B } from '../cube/geometry';
import { badness } from '../cube/validate';
import {
  CameraCapture,
  OutlineEditor,
  TWO_SHOT_VIEWS,
  allCornerViews,
  classifyCube,
  cornerFaceletMap,
  cornerQuads,
  detectCornerOutline,
  imageDataToCanvas,
  sampleCornerShot,
  sampleFace,
  type CornerOutline,
  type CornerView,
  type Quad,
} from '../vision';
import type { CubeView } from '../viewer';
import { Cube3D } from './Cube3D';
import type { FacePhoto } from './model';

interface Props {
  onDone: (photos: (FacePhoto | null)[]) => void;
  onCancel: () => void;
}

interface Shot {
  image: ImageData;
  outline: CornerOutline;
}

const SURE = 0.9;
const STEPS = [
  { title: 'first corner', how: 'Point one corner of the cube at the camera so that you see three sides about equally: one on top and two below, like the picture.' },
  { title: 'opposite corner', how: 'Turn the cube over and point the opposite corner at the camera, so you see the three sides that were hidden. Any of them can be on top.' },
];

function css(rgb: Float32Array, i: number): string {
  return 'rgb(' + Math.round(rgb[i * 3] as number) + ',' + Math.round(rgb[i * 3 + 1] as number) + ',' + Math.round(rgb[i * 3 + 2] as number) + ')';
}

/** The three faces of a corner shot as straight-on "photos": each face with its outline turned to the reading orientation. */
export function cornerShotFaces(shot: Shot, view: CornerView): { face: number; photo: FacePhoto }[] {
  const quads = cornerQuads(shot.outline);
  const map = cornerFaceletMap(view);
  const cornerOf = (i: number): number => (i === 0 ? 0 : i === 5 ? 1 : i === 35 ? 2 : 3);
  return [0, 1, 2].map((k) => {
    const source = new Array<number>(36);
    for (let i = 0; i < 36; i++) source[(map[k * 36 + i] as number) % 36] = i;
    const q = quads[k] as Quad;
    const quad = [0, 5, 35, 30].map((target) => q[cornerOf(source[target] as number)]) as Quad;
    return { face: Math.floor((map[k * 36] as number) / 36), photo: { image: shot.image, quad, sample: sampleFace(shot.image, quad) } };
  });
}

/** Six face photos from two corner shots, trying each way up for the second shot. */
export function assembleTwoShots(first: Shot, second: Shot): { photos: (FacePhoto | null)[]; badness: number } {
  const hidden = new Set([D, L, B]);
  const candidates = allCornerViews().filter((v) => hidden.has(v.top) && hidden.has(v.left) && hidden.has(v.right));
  let best: { photos: (FacePhoto | null)[]; badness: number } | null = null;
  for (const view of candidates) {
    const photos: (FacePhoto | null)[] = [null, null, null, null, null, null];
    for (const f of cornerShotFaces(first, TWO_SHOT_VIEWS[0])) photos[f.face] = f.photo;
    for (const f of cornerShotFaces(second, view)) photos[f.face] = f.photo;
    const score = badness(classifyCube(photos.map((p) => (p as FacePhoto).sample)).labels);
    if (!best || score < best.badness) best = { photos, badness: score };
  }
  return best as { photos: (FacePhoto | null)[]; badness: number };
}

export function CornerCapture({ onDone, onCancel }: Props) {
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState<(Shot & { unsure: boolean }) | null>(null);
  const [preview, setPreview] = useState<string[][] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const shots = useRef<Shot[]>([]);
  const view = useRef<CubeView | null>(null);
  const camHost = useRef<HTMLDivElement>(null);
  const editHost = useRef<HTMLDivElement>(null);
  const outline = useRef<CornerOutline | null>(null);
  const step = STEPS[index] as (typeof STEPS)[number];

  const paintGuide = (animate: boolean): void => {
    const v = view.current;
    if (!v) return;
    const state = new Uint8Array(216).fill(255);
    const palette: string[] = new Array<string>(216).fill('#4a5361');
    const first = shots.current[0];
    if (first)
      for (const f of cornerShotFaces(first, TWO_SHOT_VIEWS[0]))
        for (let i = 0; i < 36; i++) {
          state[f.face * 36 + i] = f.face * 36 + i;
          palette[f.face * 36 + i] = css(f.photo.sample.rgb, i);
        }
    v.setState(state, palette);
    void v.setPose(index === 0 ? null : { front: L, up: D }, animate ? 1100 : 0);
  };

  useEffect(() => paintGuide(index > 0), [index]);

  useEffect(() => {
    if (frame) return;
    let alive = true;
    const cam = new CameraCapture(camHost.current as HTMLDivElement, { guide: false });
    const loop = (): void => {
      cam
        .capture()
        .then((f) => {
          if (!alive) return;
          setBusy('Finding the cube...');
          // Let the message paint before the outline search, which takes a moment on a phone.
          setTimeout(() => {
            if (!alive) return;
            const found = detectCornerOutline(f.image);
            setBusy('');
            setFrame({ image: f.image, outline: found.outline, unsure: found.confidence < SURE });
          }, 30);
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

  useEffect(() => {
    if (!frame) return;
    outline.current = frame.outline;
    const refresh = (): void => {
      const faces = sampleCornerShot(frame.image, outline.current as CornerOutline);
      setPreview(faces.map((s) => Array.from({ length: 36 }, (_, i) => css(s.rgb, i))));
    };
    let timer = 0;
    const editor = new OutlineEditor(editHost.current as HTMLDivElement, imageDataToCanvas(frame.image), frame.outline, (o) => {
      outline.current = o;
      clearTimeout(timer);
      timer = window.setTimeout(refresh, 80);
    });
    refresh();
    return () => {
      clearTimeout(timer);
      editor.destroy();
    };
  }, [frame]);

  const retake = (): void => {
    setFrame(null);
    setPreview(null);
    setError('');
  };

  const accept = (): void => {
    if (!frame || !outline.current) return;
    shots.current[index] = { image: frame.image, outline: outline.current };
    if (index === 0) {
      retake();
      setIndex(1);
      return;
    }
    const result = assembleTwoShots(shots.current[0] as Shot, shots.current[1] as Shot);
    if (result.badness > 70) {
      retake();
      setError('These two photos do not fit together as one cube. The second photo must show the three sides that were hidden in the first, with the grid on the stickers. Take it again.');
      return;
    }
    onDone(result.photos);
  };

  const back = (): void => {
    if (frame) retake();
    else if (index > 0) setIndex(index - 1);
    else onCancel();
  };

  return (
    <div class="screen capture">
      <header class="bar">
        <button class="btn ghost" onClick={back}>
          Back
        </button>
        <div class="bar-title">
          Photo {index + 1} of 2: <b>{step.title}</b>
        </div>
        <div class="dots" aria-hidden="true">
          {STEPS.map((_, i) => (
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
        <p class="guide-text">{frame ? 'Drag the seven grips until the three grids sit on the stickers of the three sides. The small grids show what will be read.' : step.how}</p>
      </section>

      {error && (
        <p class="note bad" role="alert">
          {error}
        </p>
      )}
      {busy && <p class="note">{busy}</p>}

      {!frame && <div class="cam-host" ref={camHost} />}

      {frame && (
        <>
          {frame.unsure && (
            <p class="note fix" data-testid="unsure">
              The app is not sure it found the cube. Check all seven points before you continue.
            </p>
          )}
          <div class="edit-host" ref={editHost} />
          <div class="mini-grids" aria-label="Colours read from this photo: top, left and right side">
            {(preview ?? []).map((face, k) => (
              <div class="mini-face">
                <div class="mini-grid">
                  {face.map((c) => (
                    <i style={{ background: c }} />
                  ))}
                </div>
                <span>{['top', 'left', 'right'][k]}</span>
              </div>
            ))}
          </div>
          <footer class="actions">
            <button class="btn" onClick={retake}>
              Retake
            </button>
            <button class="btn primary grow" onClick={accept} data-testid="use-photo">
              {index === 1 ? 'Use photo and read colours' : 'Use photo'}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
