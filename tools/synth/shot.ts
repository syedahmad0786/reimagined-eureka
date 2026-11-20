/** Parameters of one synthetic photo. Shared by the renderer page and the generator script. */
export interface ShotParams {
  width: number;
  height: number;
  /** 216 colour ids in CONVENTIONS.md order. */
  state: number[];
  /** Plastic or sticker colour per colour id, CSS hex (albedo, before lighting). */
  palette: string[];
  style: 'stickerless' | 'stickered';
  kind: 'face' | 'corner';
  /** Face photographed straight on (kind face). */
  face?: number;
  /** Faces shown by a corner shot (kind corner). */
  view?: { top: number; left: number; right: number };
  camera: {
    distance: number;
    fovDeg: number;
    /** Angle off the face normal, and the compass direction of that lean. */
    tiltDeg: number;
    tiltAzimuthDeg: number;
    rollDeg: number;
    /** Where the camera aims, in cube units away from the cube centre (image right, image up). */
    aimX: number;
    aimY: number;
    /** Corner shots only: height of the camera above the horizontal, and its swing around the vertical edge. */
    elevationDeg: number;
    swingDeg: number;
  };
  light: {
    ambient: number;
    ambientColor: [number, number, number];
    key: number;
    keyColor: [number, number, number];
    /** Direction toward the key light in stage coordinates (x right, y up, z toward the camera for a face shot). */
    keyDir: [number, number, number];
    /** Near lamp: gives a brightness gradient across the cube. Position in stage coordinates. */
    lamp?: { position: [number, number, number]; intensity: number; color: [number, number, number] };
    /** Lamp placed so that its mirror reflection lands on the photographed face at (u, v) in 0..1. */
    glare?: { u: number; v: number; intensity: number; distance: number; /** Corner shots: 0 top, 1 left, 2 right face. */ face?: number };
    /** Invisible slab that shades part of the cube from the key light. */
    occluder?: { offset: number; angleDeg: number };
  };
  material: { roughness: number; clearcoat: number; clearcoatRoughness: number };
  background: { type: 'plain' | 'gradient' | 'wood' | 'paper' | 'clutter'; seed: number; base: [number, number, number] };
  post: {
    gain: number;
    whiteBalance: [number, number, number];
    gradient: { angleDeg: number; strength: number };
    blurPx: number;
    noiseSigma: number;
    /** 0 means PNG. */
    jpegQuality: number;
  };
  seed: number;
}

export interface ShotResult {
  dataUrl: string;
  /** Face shots: true corners of the 6x6 area (top-left, top-right, bottom-right, bottom-left). */
  quad?: number[][];
  /** Corner shots: the seven outline points. */
  outline?: number[][];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
