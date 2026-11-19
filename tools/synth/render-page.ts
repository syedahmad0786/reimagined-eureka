/**
 * Renders synthetic photos of a 6x6x6 cube with three.js. Driven from tools/synth/generate.ts through
 * window.renderShot(params). Has its own simple cube mesh built from src/cube/geometry.ts.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FACE_NORMALS, faceletCubie, type Vec3 } from '../../src/cube/geometry';
import { mulberry32, type ShotParams, type ShotResult } from './shot';

const stageEl = document.getElementById('stage') as HTMLElement;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stageEl.appendChild(renderer.domElement);
const post = document.createElement('canvas');
stageEl.appendChild(post);

const v3 = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const rgbColor = (c: readonly number[]) => new THREE.Color().setRGB(c[0] as number, c[1] as number, c[2] as number, THREE.SRGBColorSpace);

function backgroundTexture(bg: ShotParams['background']): THREE.CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const rnd = mulberry32(bg.seed);
  const css = (r: number, gg: number, b: number) => 'rgb(' + Math.round(r) + ',' + Math.round(gg) + ',' + Math.round(b) + ')';
  const [r0, g0, b0] = bg.base.map((v) => v * 255) as [number, number, number];
  g.fillStyle = css(r0, g0, b0);
  g.fillRect(0, 0, size, size);
  if (bg.type === 'gradient') {
    const grad = g.createLinearGradient(0, 0, size * rnd(), size);
    grad.addColorStop(0, css(r0, g0, b0));
    grad.addColorStop(1, css(255 * rnd(), 255 * rnd(), 255 * rnd()));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  } else if (bg.type === 'wood') {
    g.fillStyle = css(150 + 50 * rnd(), 85 + 40 * rnd(), 35 + 30 * rnd());
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 260; i++) {
      const y = rnd() * size;
      const dark = rnd() < 0.5;
      g.strokeStyle = dark ? 'rgba(60,25,5,' + (0.08 + 0.25 * rnd()) + ')' : 'rgba(255,200,130,' + (0.05 + 0.15 * rnd()) + ')';
      g.lineWidth = 1 + rnd() * 5;
      g.beginPath();
      g.moveTo(0, y);
      const wob = 6 + rnd() * 18;
      for (let x = 0; x <= size; x += 32) g.lineTo(x, y + Math.sin(x / (40 + 80 * rnd()) + i) * wob);
      g.stroke();
    }
  } else if (bg.type === 'paper') {
    g.fillStyle = css(232 + 15 * rnd(), 232 + 15 * rnd(), 235 + 15 * rnd());
    g.fillRect(0, 0, size, size);
    g.strokeStyle = 'rgba(120,130,160,0.55)';
    g.lineWidth = 2;
    for (let y = 20; y < size; y += 44) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(size, y);
      g.stroke();
    }
    g.strokeStyle = 'rgba(30,50,160,0.8)';
    g.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      let x = rnd() * size;
      let y = rnd() * size;
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.3) * 50;
        y += (rnd() - 0.5) * 50;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  } else if (bg.type === 'clutter') {
    const cols = ['#fd8123', '#e6e8e4', '#42d152', '#eedc32', '#ca3938', '#2270b8', '#333333', '#8a5a2b', '#bbbbbb'];
    for (let i = 0; i < 150; i++) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)] as string;
      const s = 30 + rnd() * 130;
      g.save();
      g.translate(rnd() * size, rnd() * size);
      g.rotate(rnd() * Math.PI);
      g.fillRect(-s / 2, -s / 2, s, s * (0.5 + rnd()));
      g.restore();
    }
  } else {
    // plain: a little mottle so it is not perfectly flat
    for (let i = 0; i < 400; i++) {
      g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '0,0,0' : '255,255,255') + ',' + 0.02 * rnd() + ')';
      g.fillRect(rnd() * size, rnd() * size, 60 * rnd(), 60 * rnd());
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.6);
  tex.anisotropy = 4;
  return tex;
}

const roundedBox = new RoundedBoxGeometry(0.985, 0.985, 0.985, 3, 0.11);
const stickerShape = (() => {
  const s = 0.42;
  const r = 0.08;
  const shape = new THREE.Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.quadraticCurveTo(s, -s, s, -s + r);
  shape.lineTo(s, s - r);
  shape.quadraticCurveTo(s, s, s - r, s);
  shape.lineTo(-s + r, s);
  shape.quadraticCurveTo(-s, s, -s, s - r);
  shape.lineTo(-s, -s + r);
  shape.quadraticCurveTo(-s, -s, -s + r, -s);
  return new THREE.ShapeGeometry(shape, 4);
})();

/** BoxGeometry material group order: +x, -x, +y, -y, +z, -z. As face ids (U R F D L B): R L U D F B. */
const GROUP_FACE = [1, 4, 0, 3, 2, 5];

function buildCube(p: ShotParams, disposables: { dispose(): void }[]): THREE.Group {
  const group = new THREE.Group();
  const rnd = mulberry32(p.seed ^ 0x51ed);
  const body = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.55 });
  disposables.push(body);
  const mats = p.palette.map((hex) => {
    const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex), roughness: p.material.roughness, clearcoat: p.material.clearcoat, clearcoatRoughness: p.material.clearcoatRoughness });
    disposables.push(m);
    return m;
  });
  const colourAt = new Map<string, number>();
  for (let f = 0; f < 6; f++)
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 6; c++) {
        const q = faceletCubie(f, r, c);
        colourAt.set(q.join(',') + ':' + f, p.state[f * 36 + r * 6 + c] as number);
      }
  const core = new THREE.Mesh(new THREE.BoxGeometry(5.7, 5.7, 5.7), body);
  disposables.push(core.geometry);
  group.add(core);
  for (let x = 0; x < 6; x++)
    for (let y = 0; y < 6; y++)
      for (let z = 0; z < 6; z++) {
        if (x > 0 && x < 5 && y > 0 && y < 5 && z > 0 && z < 5) continue;
        const faceMats: THREE.Material[] = [];
        for (let gi = 0; gi < 6; gi++) {
          const id = colourAt.get([x, y, z].join(',') + ':' + GROUP_FACE[gi]);
          faceMats.push(id === undefined || p.style === 'stickered' ? body : (mats[id] as THREE.Material));
        }
        const mesh = new THREE.Mesh(roundedBox, faceMats);
        // Real cubies never sit perfectly flush.
        mesh.position.set(x - 2.5 + (rnd() - 0.5) * 0.012, y - 2.5 + (rnd() - 0.5) * 0.012, z - 2.5 + (rnd() - 0.5) * 0.012);
        mesh.rotation.set((rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.012);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        if (p.style === 'stickered') {
          for (let f = 0; f < 6; f++) {
            const id = colourAt.get([x, y, z].join(',') + ':' + f);
            if (id === undefined) continue;
            const n = v3(FACE_NORMALS[f] as Vec3);
            const sticker = new THREE.Mesh(stickerShape, mats[id] as THREE.Material);
            sticker.position.copy(mesh.position).addScaledVector(n, 0.5);
            sticker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
            sticker.receiveShadow = true;
            group.add(sticker);
          }
        }
      }
  return group;
}

/** Orthonormal stage frame in world coordinates. */
function stageBasis(p: ShotParams): THREE.Matrix4 {
  let ex: THREE.Vector3;
  let ey: THREE.Vector3;
  let ez: THREE.Vector3;
  if (p.kind === 'face') {
    const f = p.face as number;
    const a = v3(faceletCubie(f, 0, 0));
    ex = v3(faceletCubie(f, 0, 5)).sub(a).normalize();
    ey = a.clone().sub(v3(faceletCubie(f, 5, 0))).normalize();
    ez = v3(FACE_NORMALS[f] as Vec3);
  } else {
    const view = p.view as { top: number; left: number; right: number };
    ex = v3(FACE_NORMALS[view.right] as Vec3);
    ey = v3(FACE_NORMALS[view.top] as Vec3);
    ez = v3(FACE_NORMALS[view.left] as Vec3);
  }
  return new THREE.Matrix4().makeBasis(ex, ey, ez);
}

async function renderShot(p: ShotParams): Promise<ShotResult> {
  const disposables: { dispose(): void }[] = [];
  renderer.setSize(p.width, p.height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020);
  const basis = stageBasis(p);
  const stage = new THREE.Group();
  stage.applyMatrix4(basis);
  scene.add(stage);
  scene.add(buildCube(p, disposables));

  // Table: behind the cube for a face shot, under it for a corner shot.
  const tex = backgroundTexture(p.background);
  const tableMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), tableMat);
  disposables.push(tex, tableMat, table.geometry);
  table.receiveShadow = true;
  if (p.kind === 'face') table.position.set(0, 0, -3.02);
  else {
    table.rotation.x = -Math.PI / 2;
    table.position.set(0, -3.02, 0);
  }
  table.rotateZ(mulberry32(p.background.seed + 7)() * Math.PI);
  stage.add(table);

  // Lights. Intensities are in units where 1 lights a white surface to full white.
  const amb = new THREE.AmbientLight(rgbColor(p.light.ambientColor), p.light.ambient * Math.PI);
  stage.add(amb);
  const key = new THREE.DirectionalLight(rgbColor(p.light.keyColor), p.light.key * Math.PI);
  const dir = v3(p.light.keyDir).normalize();
  key.position.copy(dir.clone().multiplyScalar(40));
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -12;
  key.shadow.camera.right = key.shadow.camera.top = 12;
  key.shadow.camera.near = 5;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  stage.add(key);
  stage.add(key.target);
  if (p.light.occluder) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 0.2), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    disposables.push(slab.geometry, slab.material as THREE.Material);
    const side = new THREE.Vector3(Math.cos((p.light.occluder.angleDeg * Math.PI) / 180), Math.sin((p.light.occluder.angleDeg * Math.PI) / 180), 0);
    const perp = side.clone().sub(dir.clone().multiplyScalar(side.dot(dir))).normalize();
    slab.position.copy(dir.clone().multiplyScalar(14)).addScaledVector(perp, 15 + p.light.occluder.offset);
    slab.lookAt(slab.position.clone().add(dir));
    slab.castShadow = true;
    stage.add(slab);
  }

  // Camera.
  const cam = new THREE.PerspectiveCamera(p.camera.fovDeg, p.width / p.height, 3, 200);
  const d2r = Math.PI / 180;
  let eye: THREE.Vector3;
  let up: THREE.Vector3;
  let centre: THREE.Vector3;
  if (p.kind === 'face') {
    const t = p.camera.tiltDeg * d2r;
    const az = p.camera.tiltAzimuthDeg * d2r;
    centre = new THREE.Vector3(0, 0, 3);
    eye = new THREE.Vector3(Math.sin(t) * Math.cos(az), Math.sin(t) * Math.sin(az), Math.cos(t)).multiplyScalar(p.camera.distance).add(centre);
    up = new THREE.Vector3(0, 1, 0);
  } else {
    const el = p.camera.elevationDeg * d2r;
    const sw = (45 + p.camera.swingDeg) * d2r;
    centre = new THREE.Vector3(0, 0, 0);
    eye = new THREE.Vector3(Math.cos(el) * Math.sin(sw), Math.sin(el), Math.cos(el) * Math.cos(sw)).multiplyScalar(p.camera.distance);
    up = new THREE.Vector3(0, 1, 0);
  }
  const forward = centre.clone().sub(eye).normalize();
  const right = forward.clone().cross(up).normalize();
  const camUp = right.clone().cross(forward).normalize();
  const aim = centre.clone().addScaledVector(right, p.camera.aimX).addScaledVector(camUp, p.camera.aimY);
  const rolledUp = camUp.clone().applyAxisAngle(forward, p.camera.rollDeg * d2r);
  const toWorld = (v: THREE.Vector3) => v.clone().applyMatrix4(basis);
  cam.position.copy(toWorld(eye));
  cam.up.copy(rolledUp.clone().transformDirection(basis));
  cam.lookAt(toWorld(aim));
  cam.updateMatrixWorld(true);

  if (p.light.lamp) {
    const lamp = new THREE.PointLight(rgbColor(p.light.lamp.color), p.light.lamp.intensity * Math.PI * 100, 0, 2);
    lamp.position.copy(v3(p.light.lamp.position));
    stage.add(lamp);
  }
  if (p.light.glare) {
    // Mirror the camera in the plane of the glared face and put the lamp on the line through the target point,
    // so that the reflection of the lamp lands there. Face shots: the photographed face. Corner shots: top, left or right.
    const s = (p.light.glare.u - 0.5) * 6;
    const t = (0.5 - p.light.glare.v) * 6;
    const which = p.kind === 'face' ? 1 : (p.light.glare.face ?? 0);
    // Plane normal axis in stage coordinates: top = y, left = z, right = x.
    const axis = which === 0 ? 1 : which === 1 ? 2 : 0;
    const target = axis === 1 ? new THREE.Vector3(s, 3, t) : axis === 2 ? new THREE.Vector3(s, t, 3) : new THREE.Vector3(3, t, s);
    const out = target.clone().sub(eye).normalize();
    const mirrored = target.clone().addScaledVector(out, p.light.glare.distance);
    const lampPos = mirrored.clone();
    lampPos.setComponent(axis, 6 - mirrored.getComponent(axis));
    const lamp = new THREE.PointLight(0xffffff, p.light.glare.intensity * Math.PI * p.light.glare.distance * p.light.glare.distance, 0, 2);
    lamp.position.copy(lampPos);
    stage.add(lamp);
  }

  renderer.render(scene, cam);

  // True outline in pixels.
  const project = (s: readonly number[]): number[] => {
    const w = toWorld(v3(s)).project(cam);
    return [((w.x + 1) / 2) * p.width, ((1 - w.y) / 2) * p.height];
  };
  const result: ShotResult = { dataUrl: '' };
  if (p.kind === 'face') {
    result.quad = [
      [-3, 3, 3],
      [3, 3, 3],
      [3, -3, 3],
      [-3, -3, 3],
    ].map(project);
  } else {
    result.outline = [
      [3, 3, 3],
      [-3, 3, -3],
      [3, 3, -3],
      [3, -3, -3],
      [3, -3, 3],
      [-3, -3, 3],
      [-3, 3, 3],
    ].map(project);
  }

  // Camera pipeline: blur, exposure, white balance, vignette-like gradient, sensor noise, JPEG.
  post.width = p.width;
  post.height = p.height;
  const g = post.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.filter = p.post.blurPx > 0.05 ? 'blur(' + p.post.blurPx.toFixed(2) + 'px)' : 'none';
  g.drawImage(renderer.domElement, 0, 0);
  g.filter = 'none';
  const img = g.getImageData(0, 0, p.width, p.height);
  const data = img.data;
  const rnd = mulberry32(p.seed ^ 0xa5a5);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  const ga = p.post.gradient.angleDeg * d2r;
  const gx = Math.cos(ga);
  const gy = Math.sin(ga);
  const half = Math.hypot(p.width, p.height) / 2;
  const toLin = (v: number) => Math.pow(v / 255, 2.2);
  const toSrgb = (v: number) => 255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const o = (y * p.width + x) * 4;
      const t = ((x - p.width / 2) * gx + (y - p.height / 2) * gy) / half;
      const shade = p.post.gain * (1 + p.post.gradient.strength * t);
      for (let c = 0; c < 3; c++) {
        const lin = toLin(data[o + c] as number) * shade * (p.post.whiteBalance[c] as number);
        data[o + c] = toSrgb(lin) + (p.post.noiseSigma > 0 ? gauss() * p.post.noiseSigma : 0);
      }
    }
  }
  g.putImageData(img, 0, 0);
  result.dataUrl = p.post.jpegQuality > 0 ? post.toDataURL('image/jpeg', p.post.jpegQuality) : post.toDataURL('image/png');
  for (const d of disposables) d.dispose();
  renderer.renderLists.dispose();
  return result;
}

declare global {
  interface Window {
    renderShot: (p: ShotParams) => Promise<ShotResult>;
    synthReady: boolean;
  }
}
window.renderShot = renderShot;
window.synthReady = true;
