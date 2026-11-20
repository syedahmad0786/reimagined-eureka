/**
 * CubeView: a three.js view of a 6x6x6 cube that shows a state and demonstrates one move at a time.
 * The cube never turns as a whole during a solve; only the camera orbits. See index.ts for the API.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FACE_NAMES, FACE_NORMALS } from '../cube/geometry';
import { describeMove, sameMove, type Move } from '../cube/moves';
import { CubeModel, HALF, LIFT, checkMove } from './model';
import { buildFaceFrame, buildMoveIndicator, type ArrowInfo, type MoveIndicator } from './indicator';

export interface CubeViewOptions {
  /** Let the user orbit the camera with drag / one-finger swipe and pinch zoom. Default true. */
  interactive?: boolean;
  /** Small "TOP / FRONT / RIGHT" style markers that stay with the cube so the user keeps their bearings. Default true. */
  faceLabels?: boolean;
  /** A soft shadow under the cube, so it sits on the page instead of floating. Default true. */
  shadow?: boolean;
}

/** What debug() returns. For tests and the demo page only. */
export interface CubeViewDebug {
  /** Frames drawn since the view was created. */
  renderCount: number;
  animating: boolean;
  shown: Move | null;
  camera: { x: number; y: number; z: number; distance: number; fitDistance: number };
  /** Arrows of the shown move, in the cube's own frame (x right, y up, z toward the viewer; faces at +-3). */
  arrows: { kind: string; heads: number; tail: number[]; mid: number[]; tip: number[]; tailNormal: number[]; midNormal: number[]; tipNormal: number[] }[];
  /** Where the home place of a facelet is drawn, in CSS pixels from the top left of the view. */
  project(face: number, row: number, col: number): { x: number; y: number };
}

const FOV = 30;
const DEFAULT_AZIMUTH = (33 * Math.PI) / 180;
const DEFAULT_ELEVATION = (29 * Math.PI) / 180;
/**
 * The camera never rolls, so however the user orbits, the cube reaches at most a face diagonal to the
 * sides and a cube diagonal up and down. Fitting those (with room for the labels above and below)
 * keeps the cube as large as a narrow phone screen allows without ever clipping it.
 */
const FIT_ACROSS = HALF * Math.SQRT2 * LIFT * 1.05;
const FIT_UPRIGHT = HALF * Math.sqrt(3) * LIFT * 1.1;
const DEFAULT_DIRECTION = new THREE.Vector3(
  Math.sin(DEFAULT_AZIMUTH) * Math.cos(DEFAULT_ELEVATION),
  Math.sin(DEFAULT_ELEVATION),
  Math.cos(DEFAULT_AZIMUTH) * Math.cos(DEFAULT_ELEVATION),
);

/**
 * Light for the black plastic only. Stickers are drawn unlit, in exactly the colours of the palette,
 * so a sticker on screen can be compared with the one in the hand whichever side it is on.
 */
const AMBIENT = 0.75;
const KEY = new THREE.Vector3(0.3, 0.75, 0.5);

type Slot = 'turn' | 'pose' | 'camera';

interface Tween {
  start: number;
  duration: number;
  step(t: number): void;
  done(): void;
  timer: ReturnType<typeof setTimeout>;
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Like ease, but runs a few degrees past the end and settles back, like a layer clicking into place. */
function easeClick(t: number): number {
  const spring = (x: number): number => 1 - Math.exp(-SPRING_DECAY * x) * (Math.cos(SPRING_RATE * x) + (SPRING_DECAY / SPRING_RATE) * Math.sin(SPRING_RATE * x));
  return spring(t) + (1 - spring(1)) * t;
}
const SPRING_DECAY = 6.2;
const SPRING_RATE = 6.3;

function smoothstep(a: number, b: number, t: number): number {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

function faceNormal(face: number): THREE.Vector3 {
  const n = FACE_NORMALS[face];
  if (!n) throw new Error('bad face ' + face);
  return new THREE.Vector3(n[0], n[1], n[2]);
}

export class CubeView {
  private readonly container: HTMLElement;
  private readonly wrap: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 200);
  private readonly controls: OrbitControls | null;
  private readonly model = new CubeModel();
  private readonly observer: ResizeObserver;
  private readonly labels: { el: HTMLDivElement; width: number; height: number }[] = [];
  private readonly badge: HTMLDivElement;
  private readonly layerPill: HTMLDivElement;
  private readonly cornerRing: HTMLDivElement;
  private cornerMarked = false;
  /** The user has dragged the view since it was last reset, so aim() leaves it where they put it. */
  private userOrbit = false;
  private readonly colours: { highlight: string; arrow: string; arrowEdge: string };

  private tweens: Partial<Record<Slot, Tween>> = {};
  private frame = 0;
  private renderCount = 0;
  private fitDistance = 0;
  private width = 0;
  private height = 0;
  private shown: Move | null = null;
  private indicator: MoveIndicator | null = null;
  private indicatorOpacity = 1;
  private faceMark: { group: THREE.Group; dispose(): void } | null = null;
  private disposed = false;
  private spinRate = 0;
  private spinLast = 0;
  private shadow: { mesh: THREE.Mesh; dispose(): void } | null = null;

  constructor(container: HTMLElement, options: CubeViewOptions = {}) {
    this.container = container;
    const css = getComputedStyle(container);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    this.colours = {
      highlight: token('--cube-outline', '') || token('--highlight', '#7df9ff'),
      arrow: token('--cube-arrow', '#ff3fd0'),
      arrowEdge: token('--cube-arrow-edge', '#05070a'),
    };

    this.wrap = document.createElement('div');
    this.wrap.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;-webkit-tap-highlight-color:transparent;';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '3D view of the cube');
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    this.wrap.append(canvas, this.overlay);
    container.append(this.wrap);

    this.scene.add(this.model.root);
    this.scene.add(new THREE.AmbientLight(0xffffff, AMBIENT * Math.PI));
    const key = new THREE.DirectionalLight(0xffffff, KEY.length() * Math.PI);
    key.position.copy(KEY);
    this.scene.add(key);
    if (options.shadow !== false) {
      this.shadow = this.buildShadow();
      this.scene.add(this.shadow.mesh);
    }

    const pill =
      'position:absolute;left:0;top:0;white-space:nowrap;border-radius:999px;font-family:var(--font, system-ui, sans-serif);will-change:transform,opacity;';
    if (options.faceLabels !== false) {
      for (const name of FACE_NAMES) {
        const el = document.createElement('div');
        el.textContent = name.toUpperCase();
        el.style.cssText =
          pill +
          'padding:5px 9px;font-size:13px;font-weight:650;line-height:1;letter-spacing:0.06em;color:var(--text-dim, #9ba6b5);' +
          'background:var(--surface-2, #1e232c);border:1px solid var(--border, #2c3440);opacity:0;';
        this.overlay.append(el);
        this.labels.push({ el, width: 0, height: 0 });
      }
    }
    this.badge = document.createElement('div');
    this.badge.textContent = '180\u00b0';
    this.badge.style.cssText =
      pill +
      'padding:5px 9px;font-size:16px;font-weight:800;line-height:1;color:var(--accent-ink, #051120);' +
      'background:var(--highlight, #7df9ff);box-shadow:0 0 0 2px var(--accent-ink, #051120), 0 2px 8px rgba(0,0,0,0.5);opacity:0;';
    this.overlay.append(this.badge);
    // The number is drawn from a data attribute, so the overlay's own text stays the face names and "180°".
    if (!document.getElementById('cube-view-layers')) {
      const style = document.createElement('style');
      style.id = 'cube-view-layers';
      style.textContent = '[data-layers]::after{content:attr(data-layers)}';
      document.head.append(style);
    }
    this.layerPill = document.createElement('div');
    this.layerPill.style.cssText =
      pill +
      'min-width:28px;padding:6px 8px;text-align:center;font-size:16px;font-weight:800;line-height:1;color:var(--accent-ink, #051120);' +
      'background:var(--highlight, #7df9ff);box-shadow:0 0 0 2px var(--accent-ink, #051120), 0 2px 8px rgba(0,0,0,0.5);opacity:0;';
    this.cornerRing = document.createElement('div');
    this.cornerRing.style.cssText =
      'position:absolute;left:0;top:0;width:68px;height:68px;border-radius:50%;border:4px solid var(--highlight, #7df9ff);' +
      'box-shadow:0 0 0 2px var(--accent-ink, #051120), inset 0 0 0 2px var(--accent-ink, #051120);will-change:transform,opacity;opacity:0;';
    this.overlay.append(this.layerPill, this.cornerRing);

    if (options.interactive !== false) {
      const controls = new OrbitControls(this.camera, canvas);
      controls.enablePan = false;
      controls.enableDamping = false;
      controls.rotateSpeed = 0.9;
      controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      controls.addEventListener('change', this.requestRender);
      controls.addEventListener('start', this.onControlStart);
      this.controls = controls;
    } else {
      this.controls = null;
    }

    canvas.addEventListener('webglcontextrestored', this.requestRender);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.wrap);
    this.resize();
  }

  /** Show this state. palette[colourId] is a CSS colour; any id outside the palette is drawn as a grey "unknown" sticker. Cancels any running animation. */
  setState(facelets: ArrayLike<number>, palette: readonly string[]): void {
    this.finish('turn');
    this.clearShown();
    this.model.setState(facelets, palette);
    this.requestRender();
  }

  /** The 216 facelets read back from where the 3D sticker meshes actually are now. */
  getState(): Uint8Array {
    return this.model.getState();
  }

  /** Mark the layers this move turns and show its direction arrows, without turning anything. null clears it. */
  showMove(move: Move | null): void {
    if (move) checkMove(move);
    this.finish('turn');
    this.clearShown();
    if (move) {
      this.shown = { axis: move.axis, lo: move.lo, hi: move.hi, q: move.q };
      this.model.hold(move, true);
      this.model.setDim(move);
      this.indicator = buildMoveIndicator(move, { arrow: this.colours.arrow, arrowEdge: this.colours.arrowEdge, outline: this.colours.highlight });
      this.indicatorOpacity = 1;
      this.model.decor.add(this.indicator.group);
      // Inner slices and wide turns carry their layer numbers, counted from the named face, so nobody has to count columns.
      const d = describeMove(move);
      this.layerPill.dataset.layers = d.toLayer === 1 ? '' : d.fromLayer === d.toLayer ? String(d.fromLayer) : d.fromLayer + '\u2013' + d.toLayer;
    }
    this.requestRender();
  }

  /** Turn the layers with an eased animation, then commit the new state. Resolves when done. */
  animateMove(move: Move, options: { durationMs?: number } = {}): Promise<void> {
    checkMove(move);
    this.finish('turn');
    // A quick turn clicks into place; a slow one is a demonstration and moves evenly.
    const curve = (options.durationMs ?? 450) <= 600 ? easeClick : ease;
    const decorated = this.shown !== null && sameMove(this.shown, move);
    if (!decorated) {
      this.clearShown();
      this.model.hold(move, false);
    }
    return new Promise<void>((resolve) => {
      this.start(
        'turn',
        options.durationMs ?? 450,
        (t) => {
          this.model.setTurn(curve(t));
          if (!decorated) return;
          this.model.setLift(1 - smoothstep(0.7, 1, t));
          this.indicatorOpacity = 1 - smoothstep(0.3, 0.85, t);
          this.indicator?.setOpacity(this.indicatorOpacity);
        },
        () => {
          this.model.commit();
          this.clearShown();
          resolve();
        },
      );
    });
  }

  /** Apply a move with no animation. */
  applyMove(move: Move): void {
    checkMove(move);
    this.finish('turn');
    this.clearShown();
    this.model.applyMove(move);
    this.requestRender();
  }

  /** Bring the camera back to the default three-quarter view (top, front and right faces visible). */
  resetCamera(animate = true): void {
    this.userOrbit = false;
    this.orbitTo(DEFAULT_DIRECTION, animate ? 380 : 0);
  }

  /**
   * Orbit a little toward the side this move is on, so a turn of the back, left or bottom layers is not
   * seen edge-on. The top, front and right faces all stay in view. null returns to the default view.
   * Once the user has dragged the view this does nothing, until resetCamera.
   */
  aim(move: Move | null, animate = true): void {
    if (this.userOrbit) return;
    const to = new THREE.Spherical().setFromVector3(DEFAULT_DIRECTION);
    const face = move ? describeMove(move).face : '';
    if (face === 'B') [to.theta, to.phi] = [to.theta + 0.42, to.phi - 0.14];
    else if (face === 'L') [to.theta, to.phi] = [to.theta - 0.2, to.phi - 0.14];
    else if (face === 'D') to.phi += 0.2;
    this.orbitTo(new THREE.Vector3().setFromSpherical(to), animate ? 420 : 0);
  }

  /** Ring the top-front-right corner piece, the one the "hold your cube like this" card names. */
  markCorner(on: boolean): void {
    this.cornerMarked = on;
    this.requestRender();
  }

  private orbitTo(direction: THREE.Vector3, ms: number): void {
    this.finish('camera');
    const from = new THREE.Spherical().setFromVector3(this.camera.position);
    const to = new THREE.Spherical().setFromVector3(direction);
    to.radius = this.fitDistance;
    to.theta = from.theta + Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
    const now = new THREE.Spherical();
    const end = direction.clone().normalize().multiplyScalar(this.fitDistance);
    this.start(
      'camera',
      ms,
      (t) => {
        const e = ease(t);
        now.set(from.radius + (to.radius - from.radius) * e, from.phi + (to.phi - from.phi) * e, from.theta + (to.theta - from.theta) * e);
        this.placeCamera(new THREE.Vector3().setFromSpherical(now));
      },
      () => this.placeCamera(end),
    );
  }

  /**
   * Orbit the camera round the cube at this many radians a second (0 stops). The cube itself stays put.
   * Used where the cube is on show rather than being read: the home screen and the solved screen.
   */
  spin(radiansPerSecond: number): void {
    this.spinRate = radiansPerSecond;
    this.spinLast = 0;
    this.requestRender();
  }

  /**
   * For the photo-capture guide only: rotate the whole cube so that face "front" faces the viewer
   * (world +z, the side the default camera looks at) and face "up" points up, over ms milliseconds.
   * setPose(null) returns to the reference orientation.
   */
  setPose(pose: { front: number; up: number } | null, ms = 600): Promise<void> {
    const target = new THREE.Quaternion();
    if (pose) {
      const front = faceNormal(pose.front);
      const up = faceNormal(pose.up);
      if (front.dot(up) !== 0) throw new Error('setPose: front and up must be neighbouring faces');
      const right = new THREE.Vector3().crossVectors(up, front);
      target.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, front).transpose());
    }
    this.finish('pose');
    const root = this.model.root;
    const from = root.quaternion.clone();
    return new Promise<void>((resolve) => {
      this.start(
        'pose',
        ms,
        (t) => root.quaternion.slerpQuaternions(from, target, ease(t)),
        () => {
          root.quaternion.copy(target);
          resolve();
        },
      );
    });
  }

  /**
   * For the capture guide: outline one face (0..5 = U R F D L B) with a bright frame, or null to clear.
   * upToward names the neighbouring face that must be at the top of the photo; an "UP" arrow on the
   * highlighted face then points at that edge.
   */
  highlightFace(face: number | null, options: { upToward?: number } = {}): void {
    if (this.faceMark) {
      this.model.root.remove(this.faceMark.group);
      this.faceMark.dispose();
      this.faceMark = null;
    }
    if (face !== null) {
      const normal = faceNormal(face);
      const frame = buildFaceFrame(normal, this.colours.highlight);
      const disposers = [frame.dispose];
      if (options.upToward !== undefined) {
        const up = faceNormal(options.upToward);
        if (up.dot(normal) !== 0) throw new Error('highlightFace: upToward must be a neighbour of the face');
        const marker = this.buildUpMarker(normal, up);
        frame.group.add(marker.mesh);
        disposers.push(marker.dispose);
      }
      this.model.root.add(frame.group);
      this.faceMark = { group: frame.group, dispose: () => disposers.forEach((d) => d()) };
    }
    this.requestRender();
  }

  /** Fit the canvas to its container. Called automatically when the container changes size. */
  resize(): void {
    if (this.disposed) return;
    const width = this.wrap.clientWidth;
    const height = this.wrap.clientHeight;
    if (width === 0 || height === 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && ratio === this.renderer.getPixelRatio()) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const vertical = (FOV * Math.PI) / 360;
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    const fit = Math.max(HALF + FIT_ACROSS / Math.tan(horizontal), FIT_UPRIGHT / Math.sin(vertical));
    const position = this.fitDistance
      ? this.camera.position.clone().multiplyScalar(fit / this.fitDistance)
      : DEFAULT_DIRECTION.clone().multiplyScalar(fit);
    this.fitDistance = fit;
    if (this.controls) {
      this.controls.minDistance = fit * 0.5;
      this.controls.maxDistance = fit * 1.6;
    }
    this.placeCamera(position);
    for (const label of this.labels) {
      label.width = label.el.offsetWidth;
      label.height = label.el.offsetHeight;
    }
    // Draw at once: resizing clears the canvas, and waiting a frame would flash.
    this.cancelFrame();
    this.draw();
    if (this.hasTweens() || this.spinRate) this.frame = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const slot of ['turn', 'pose', 'camera'] as const) this.finish(slot);
    this.clearShown();
    this.highlightFace(null);
    this.disposed = true;
    this.cancelFrame();
    this.observer.disconnect();
    this.controls?.dispose();
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.requestRender);
    this.shadow?.dispose();
    this.model.dispose();
    this.renderer.dispose();
    this.wrap.remove();
  }

  /** For tests and the demo page only. */
  debug(): CubeViewDebug {
    const p = this.camera.position;
    const flat = (v: THREE.Vector3) => [v.x, v.y, v.z];
    return {
      renderCount: this.renderCount,
      animating: this.hasTweens(),
      shown: this.shown ? { ...this.shown } : null,
      camera: { x: p.x, y: p.y, z: p.z, distance: p.length(), fitDistance: this.fitDistance },
      arrows: (this.indicator?.arrows ?? []).map((a: ArrowInfo) => ({
        kind: a.kind,
        heads: a.heads,
        tail: flat(a.tail),
        mid: flat(a.mid),
        tip: flat(a.tip),
        tailNormal: flat(a.tailNormal),
        midNormal: flat(a.midNormal),
        tipNormal: flat(a.tipNormal),
      })),
      project: (face, row, col) => {
        this.scene.updateMatrixWorld();
        return this.toScreen(CubeModel.faceletPoint(face, row, col).applyMatrix4(this.model.root.matrixWorld));
      },
    };
  }

  // ---- internals ----

  private placeCamera(position: THREE.Vector3): void {
    this.camera.position.copy(position);
    this.camera.lookAt(0, 0, 0);
    this.controls?.update();
    this.requestRender();
  }

  private onControlStart = (): void => {
    // The user took hold of the camera: stop a running "reset camera" where it is.
    this.userOrbit = true;
    const tween = this.tweens.camera;
    if (!tween) return;
    clearTimeout(tween.timer);
    delete this.tweens.camera;
  };

  private clearShown(): void {
    if (this.indicator) {
      this.model.decor.remove(this.indicator.group);
      this.indicator.dispose();
      this.indicator = null;
    }
    if (!this.shown) return;
    this.shown = null;
    this.model.release();
    this.model.setDim(null);
  }

  private buildUpMarker(normal: THREE.Vector3, up: THREE.Vector3): { mesh: THREE.Mesh; dispose(): void } {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 200;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = 'rgba(5, 8, 12, 0.88)';
    g.strokeStyle = this.colours.highlight;
    g.lineWidth = 8;
    g.beginPath();
    g.roundRect(6, 6, 308, 188, 36);
    g.fill();
    g.stroke();
    g.fillStyle = this.colours.highlight;
    g.beginPath();
    g.moveTo(70, 24);
    g.lineTo(124, 104);
    g.lineTo(90, 104);
    g.lineTo(90, 174);
    g.lineTo(50, 174);
    g.lineTo(50, 104);
    g.lineTo(16 + 0, 104);
    g.closePath();
    g.fill();
    g.font = '800 104px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('UP', 212, 106);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const geometry = new THREE.PlaneGeometry(2.4, 1.5);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const mesh = new THREE.Mesh(geometry, material);
    const right = new THREE.Vector3().crossVectors(up, normal);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
    mesh.position.copy(normal).multiplyScalar(HALF + 0.09).addScaledVector(up, HALF - 1.1);
    mesh.renderOrder = 3;
    return {
      mesh,
      dispose() {
        geometry.dispose();
        material.dispose();
        texture.dispose();
      },
    };
  }

  /** A soft dark pool on the floor under the cube. */
  private buildShadow(): { mesh: THREE.Mesh; dispose(): void } {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const fade = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    fade.addColorStop(0, 'rgba(0,0,0,0.5)');
    fade.addColorStop(0.55, 'rgba(0,0,0,0.26)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(HALF * 4.2, HALF * 4.2);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -HALF * 1.22;
    mesh.renderOrder = -1;
    return {
      mesh,
      dispose() {
        geometry.dispose();
        material.dispose();
        texture.dispose();
      },
    };
  }

  private start(slot: Slot, duration: number, step: (t: number) => void, done: () => void): void {
    this.finish(slot);
    if (!(duration > 0)) {
      done();
      this.requestRender();
      return;
    }
    // The timer finishes the animation even when the page is hidden and frames stop coming.
    const timer = setTimeout(() => this.finish(slot), duration + 400);
    this.tweens[slot] = { start: performance.now(), duration, step, done, timer };
    this.requestRender();
  }

  /** Jump a running animation to its end. */
  private finish(slot: Slot): void {
    const tween = this.tweens[slot];
    if (!tween) return;
    delete this.tweens[slot];
    clearTimeout(tween.timer);
    tween.done();
    this.requestRender();
  }

  private hasTweens(): boolean {
    return !!(this.tweens.turn || this.tweens.pose || this.tweens.camera);
  }

  private requestRender = (): void => {
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(this.tick);
  };

  private cancelFrame(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private tick = (now: number): void => {
    this.frame = 0;
    for (const slot of ['turn', 'pose', 'camera'] as const) {
      const tween = this.tweens[slot];
      if (!tween) continue;
      const t = (Math.max(now, performance.now()) - tween.start) / tween.duration;
      if (t >= 1) this.finish(slot);
      else tween.step(Math.max(0, t));
    }
    if (this.spinRate) {
      const dt = this.spinLast ? Math.min(0.05, (now - this.spinLast) / 1000) : 0;
      this.spinLast = now;
      if (!this.tweens.camera) {
        this.camera.position.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.spinRate * dt);
        this.camera.lookAt(0, 0, 0);
        this.controls?.update();
      }
    }
    this.cancelFrame();
    this.draw();
    if (this.hasTweens() || this.spinRate) this.frame = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    if (this.disposed || this.width === 0) return;
    this.renderer.render(this.scene, this.camera);
    this.renderCount++;
    this.updateOverlay();
  }

  private toScreen(world: THREE.Vector3): { x: number; y: number } {
    const p = world.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height };
  }

  /** Place the face labels just outside the cube's outline, and the half-turn badge on its arrow. */
  private updateOverlay(): void {
    const root = this.model.root;
    const cam = this.camera.position;
    if (this.labels.length) {
      const centre = this.toScreen(new THREE.Vector3());
      const corners: { x: number; y: number }[] = [];
      let radius = 1;
      for (let i = 0; i < 8; i++) {
        const c = new THREE.Vector3(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1).multiplyScalar(HALF * LIFT);
        const s = this.toScreen(c.applyQuaternion(root.quaternion));
        const rel = { x: s.x - centre.x, y: s.y - centre.y };
        corners.push(rel);
        radius = Math.max(radius, Math.hypot(rel.x, rel.y));
      }
      this.labels.forEach((label, face) => {
        const normal = faceNormal(face).applyQuaternion(root.quaternion);
        const point = normal.clone().multiplyScalar(HALF);
        const facing = normal.dot(cam.clone().sub(point).normalize());
        const s = this.toScreen(point);
        let dx = s.x - centre.x;
        let dy = s.y - centre.y;
        const length = Math.hypot(dx, dy);
        const opacity = smoothstep(0.1, 0.28, facing) * smoothstep(0.08 * radius, 0.2 * radius, length);
        label.el.style.opacity = opacity.toFixed(3);
        if (opacity === 0) return;
        // Lean toward above and below the cube: a phone in portrait has room there, not at the sides.
        dx *= 0.45;
        const lean = Math.hypot(dx, dy);
        dx /= lean;
        dy /= lean;
        let support = 0;
        for (const c of corners) support = Math.max(support, c.x * dx + c.y * dy);
        const reach = support + 8 + (Math.abs(dx) * label.width + Math.abs(dy) * label.height) / 2;
        const x = Math.min(this.width - label.width / 2 - 2, Math.max(label.width / 2 + 2, centre.x + dx * reach));
        const y = Math.min(this.height - label.height / 2 - 2, Math.max(label.height / 2 + 2, centre.y + dy * reach));
        label.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
      });
    }

    let best: THREE.Vector3 | null = null;
    let bestFacing = 0.12;
    if (this.indicator && this.shown && this.shown.q === 2) {
      const decor = this.model.decor;
      decor.updateWorldMatrix(true, false);
      for (const anchor of this.indicator.badgeAnchors) {
        const point = anchor.point.clone().applyMatrix4(decor.matrixWorld);
        const normal = anchor.normal.clone().transformDirection(decor.matrixWorld);
        // The face centre is the natural place on an outer face, so it wins whenever it is in view.
        const facing = normal.dot(cam.clone().sub(point).normalize()) + (anchor.cap ? 0.5 : 0);
        if (facing > bestFacing) [best, bestFacing] = [point, facing];
      }
    }
    if (best) {
      const s = this.toScreen(best);
      this.badge.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px) translate(-50%,-50%)';
    }
    this.badge.style.opacity = best ? this.indicatorOpacity.toFixed(3) : '0';

    let pillAt: THREE.Vector3 | null = null;
    let pillFacing = 0.12;
    if (this.indicator && this.shown && this.layerPill.dataset.layers) {
      const decor = this.model.decor;
      decor.updateWorldMatrix(true, false);
      for (const anchor of this.indicator.layerAnchors) {
        const point = anchor.point.clone().applyMatrix4(decor.matrixWorld);
        const normal = anchor.normal.clone().transformDirection(decor.matrixWorld);
        const facing = normal.dot(cam.clone().sub(point).normalize());
        if (facing > pillFacing) [pillAt, pillFacing] = [point, facing];
      }
    }
    if (pillAt) {
      const s = this.toScreen(pillAt);
      this.layerPill.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px) translate(-50%,-50%)';
    }
    this.layerPill.style.opacity = pillAt ? this.indicatorOpacity.toFixed(3) : '0';

    if (this.cornerMarked) {
      const s = this.toScreen(new THREE.Vector3(HALF, HALF, HALF).applyQuaternion(root.quaternion));
      this.cornerRing.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px) translate(-50%,-50%)';
    }
    this.cornerRing.style.opacity = this.cornerMarked ? '1' : '0';
  }
}
