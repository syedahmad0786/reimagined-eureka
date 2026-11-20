/**
 * Quick scan: two photos, each of three sides around a corner, taken from opposite corners.
 * The camera finds the cube and takes each photo by itself; what it read is shown on the photo, and
 * the seven outline points can be moved when it was not sure. The second photo may be taken with
 * any of its three sides on top: the arrangement that gives a real cube is chosen.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { D, L, B } from '../cube/geometry';
import { badness } from '../cube/validate';
import {
  CameraCapture,
  OUTLINE_SURE,
  OutlineEditor,
  ReadoutView,
  TWO_SHOT_VIEWS,
  allCornerViews,
  classifyCube,
  classifyPartial,
  cornerFaces,
  imageDataToCanvas,
  readingFor,
  type CameraStatus,
  type CornerOutline,
  type CornerView,
  type FaceSample,
} from '../vision';
import type { CubeView } from '../viewer';
import { css } from './Capture';
import { Cube3D } from './Cube3D';
import type { FacePhoto } from './model';
import { Icon, Pulse } from './ui';

interface Props {
  /** Shots taken before a reload. */
  initial?: Shot[];
  /** Called when a photo is accepted: the next photo number and the shot just stored. */
  onProgress?: (index: number, shot: Shot | null) => void;
  onDone: (photos: (FacePhoto | null)[]) => void;
  onCancel: () => void;
}

export interface Shot {
  image: ImageData;
  outline: CornerOutline;
  /** Sticker colours of the top, left and right side as the camera read them, when the outline was not moved. */
  samples?: FaceSample[];
}

const STEPS = [
  { title: 'First corner', how: 'Point one corner of the cube at the camera so that you see three sides about equally: one on top and two below, like the picture.' },
  { title: 'Opposite corner', how: 'Turn the cube over and point the opposite corner at the camera, so you see the three sides that were hidden. Any of them can be on top.' },
];

const HIDDEN = new Set([D, L, B]);
/** The ways the second photo can be the right way up. */
const SECOND_VIEWS = allCornerViews().filter((v) => HIDDEN.has(v.top) && HIDDEN.has(v.left) && HIDDEN.has(v.right));

/** The three faces of a corner shot as straight-on "photos": each face with its outline turned to the reading orientation. */
export function cornerShotFaces(shot: Shot, view: CornerView): { face: number; photo: FacePhoto }[] {
  return cornerFaces(shot.image, shot.outline, view, shot.samples).map((f) => ({ face: f.face, photo: { image: shot.image, quad: f.quad, sample: f.sample } }));
}

/** Six face photos from two corner shots, trying each way up for the second shot. */
export function assembleTwoShots(first: Shot, second: Shot): { photos: (FacePhoto | null)[]; badness: number } {
  let best: { photos: (FacePhoto | null)[]; badness: number } | null = null;
  for (const view of SECOND_VIEWS) {
    const photos: (FacePhoto | null)[] = [null, null, null, null, null, null];
    for (const f of cornerShotFaces(first, TWO_SHOT_VIEWS[0])) photos[f.face] = f.photo;
    for (const f of cornerShotFaces(second, view)) photos[f.face] = f.photo;
    const score = badness(classifyCube(photos.map((p) => (p as FacePhoto).sample)).labels);
    if (!best || score < best.badness) best = { photos, badness: score };
  }
  return best as { photos: (FacePhoto | null)[]; badness: number };
}

export function CornerCapture({ initial, onProgress, onDone, onCancel }: Props) {
  const [index, setIndex] = useState(initial?.length === 1 ? 1 : 0);
  const [frame, setFrame] = useState<(Shot & { unsure: boolean }) | null>(null);
  const [grips, setGrips] = useState(false);
  const [status, setStatus] = useState<CameraStatus | null>(null);
  const [unsureStickers, setUnsureStickers] = useState(0);
  const [error, setError] = useState('');
  const shots = useRef<Shot[]>(initial?.length === 1 ? [initial[0] as Shot] : []);
  const view = useRef<CubeView | null>(null);
  const camHost = useRef<HTMLDivElement>(null);
  const editHost = useRef<HTMLDivElement>(null);
  const readHost = useRef<HTMLDivElement>(null);
  const outline = useRef<CornerOutline | null>(null);
  const step = STEPS[index] as (typeof STEPS)[number];

  const paintGuide = (animate: boolean): void => {
    const v = view.current;
    if (!v) return;
    const state = new Uint8Array(216).fill(255);
    const palette: string[] = new Array<string>(216).fill('#544858');
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
    setStatus(null);
    const cam = new CameraCapture(camHost.current as HTMLDivElement, { mode: 'corner', auto: true, onStatus: (s) => alive && setStatus(s) });
    const loop = (): void => {
      cam
        .capture()
        .then((f) => {
          if (!alive || !f.outline) return;
          const unsure = f.confidence < OUTLINE_SURE;
          setGrips(unsure);
          setFrame({ image: f.image, outline: f.outline, samples: f.samples, unsure });
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

  /** The shot as it stands: the camera's own reading is kept only while the outline is the one it found. */
  const shotNow = (f: Shot): Shot => ({ image: f.image, outline: outline.current as CornerOutline, samples: outline.current === f.outline ? f.samples : undefined });

  useEffect(() => {
    if (!frame) return;
    if (!outline.current) outline.current = frame.outline;
    if (grips) {
      const editor = new OutlineEditor(editHost.current as HTMLDivElement, imageDataToCanvas(frame.image), outline.current, (o) => {
        outline.current = o;
      });
      return () => editor.destroy();
    }
    // Which side is which does not change the picture, so the second photo is shown with the first way up.
    const here = cornerShotFaces(shotNow(frame), index === 0 ? TWO_SHOT_VIEWS[0] : (SECOND_VIEWS[0] as CornerView));
    const slots: (FaceSample | null)[] = [null, null, null, null, null, null];
    if (index === 1) for (const f of cornerShotFaces(shots.current[0] as Shot, TWO_SHOT_VIEWS[0])) slots[f.face] = f.photo.sample;
    for (const f of here) slots[f.face] = f.photo.sample;
    const readout = new ReadoutView(readHost.current as HTMLDivElement, {});
    readout.setReading(readingFor(frame.image, here.map((f) => ({ face: f.face, quad: f.photo.quad })), classifyPartial(slots)));
    setUnsureStickers(readout.unsureCount());
    return () => readout.destroy();
  }, [frame, grips]);

  const clear = (): void => {
    outline.current = null;
    setFrame(null);
    setGrips(false);
    setError('');
  };

  const accept = (): void => {
    if (!frame || !outline.current) return;
    const shot = shotNow(frame);
    shots.current[index] = shot;
    if (index === 0) {
      clear();
      onProgress?.(1, shot);
      setIndex(1);
      return;
    }
    const result = assembleTwoShots(shots.current[0] as Shot, shot);
    if (result.badness > 70) {
      clear();
      setError('These two photos do not fit together as one cube. The second photo must show the three sides that were hidden in the first, with the grid on the stickers. Take it again.');
      return;
    }
    onDone(result.photos);
  };

  const back = (): void => {
    if (frame) clear();
    else if (index > 0) {
      onProgress?.(0, null);
      setIndex(0);
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
          {step.title}
          <small>Photo {index + 1} of 2</small>
        </div>
        <div class="bar-side" />
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
              {step.how} <span class="dim">{status?.state === 'no-camera' ? status.hint : 'Hold still and the photo is taken for you.'}</span>
            </>
          )}
          {frame && grips && 'Drag the seven points until the three grids sit on the stickers of the three sides.'}
          {frame && !grips && (
            <>
              <b>{unsureStickers ? unsureStickers + (unsureStickers === 1 ? ' sticker is' : ' stickers are') + ' not certain' : 'Read all 108 stickers'}</b>
              Each chip shows the colour that was read. If they match your cube, carry on.
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
          {status && status.state !== 'no-camera' && status.state !== 'starting' && (
            <p class={'cam-status' + (steady ? ' steady' : '')} role="status" data-testid="cam-status" data-state={status.state}>
              {steady ? (
                <svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
                  <circle class="ring-track" cx="18" cy="18" r="14" />
                  <circle class="ring-fill" cx="18" cy="18" r="14" stroke-dasharray="88" stroke-dashoffset={88 * (1 - status.progress)} />
                </svg>
              ) : (
                status.state === 'searching' && <Pulse />
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
              The app is not sure it found the cube. Check all seven points before you carry on.
            </p>
          )}
          <div class="read-wrap">{grips ? <div class="edit-host" ref={editHost} key="edit" /> : <div class="read-host" ref={readHost} key="read" data-testid="readout" />}</div>
          <button class="link" onClick={() => setGrips(!grips)} data-testid="toggle-grips">
            {grips ? 'Show what was read' : 'The grids are off? Move their corners'}
          </button>
          <footer class="actions sticky">
            <button class="btn big" onClick={clear} data-testid="retake">
              Retake
            </button>
            <button class="btn primary big grow" onClick={accept} data-testid="use-photo">
              {index === 1 ? 'Looks right, read the cube' : 'Looks right, next corner'}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
