/** Colour conversions: sRGB (0..255) <-> linear <-> CIELAB (D65). */

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function srgbToLinear(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 1;
  const i = Math.floor(v);
  const f = v - i;
  return (SRGB_TO_LINEAR[i] as number) * (1 - f) + (SRGB_TO_LINEAR[i + 1] as number) * f;
}

export function linearToSrgb(l: number): number {
  const c = l <= 0 ? 0 : l >= 1 ? 1 : l;
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116;
}

function labFInv(t: number): number {
  const t3 = t * t * t;
  return t3 > 216 / 24389 ? t3 : (t - 16 / 116) / (24389 / 27 / 116);
}

/** sRGB 0..255 to CIELAB (L 0..100). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIELAB to sRGB 0..255, clipped to the gamut. */
export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const x = labFInv(fy + a / 500) * 0.95047;
  const y = labFInv(fy);
  const z = labFInv(fy - b / 200) * 1.08883;
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

export function rgbToCss(r: number, g: number, b: number): string {
  const h = (v: number) => {
    const n = Math.max(0, Math.min(255, Math.round(v)));
    return (n < 16 ? '0' : '') + n.toString(16);
  };
  return '#' + h(r) + h(g) + h(b);
}
