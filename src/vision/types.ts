/** Shared types for the photo recognition module. */

/** Image pixel coordinates. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Top-left, top-right, bottom-right, bottom-left of the 6x6 sticker area as it should read
 * (row 0 at the top).
 */
export type Quad = [Point, Point, Point, Point];

/** Anything shaped like ImageData (RGBA, 8 bit). A browser ImageData satisfies it; Node code can pass plain objects. */
export interface ImageLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

export interface FaceSample {
  /** 36 x 3 mean colour per sticker, sRGB 0..255, row-major. */
  rgb: Float32Array;
  /** 36 x 3 the same in CIELAB. */
  lab: Float32Array;
  /** 36 values 0..1: how trustworthy each sample is (low for glare, mixed pixels, strong shading). */
  quality: Float32Array;
}

export type ColourName = 'white' | 'yellow' | 'red' | 'orange' | 'blue' | 'green' | 'other';

export interface Classification {
  /** 216 colour ids 0..5 in facelet order (faces U R F D L B), exactly 36 of each. */
  labels: Uint8Array;
  /** 216 values 0..1. */
  confidence: Float32Array;
  /** 216 x 6 cost of assigning each sticker to each colour id (lower is better). */
  costs: Float32Array;
  /** CSS colour to draw each colour id with, derived from what the camera saw. */
  palette: string[];
  /** Best-guess name per colour id. Only for labels in the UI. */
  names: ColourName[];
}

/**
 * The seven points of a cube seen corner-on, in image coordinates:
 *
 *   0  near corner, where the three visible faces meet
 *   1  far corner of the top face (the back of the silhouette)
 *   2  end of the edge between the top face and the right face
 *   3  far (lower right) corner of the right face
 *   4  bottom end of the edge between the left face and the right face
 *   5  far (lower left) corner of the left face
 *   6  end of the edge between the top face and the left face
 *
 * Points 1..6 walk clockwise around the silhouette starting at the back.
 */
export type CornerOutline = [Point, Point, Point, Point, Point, Point, Point];
