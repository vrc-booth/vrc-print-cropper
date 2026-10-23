/**
 * RGBA, 8 bits per channel, row-major, no padding: data.length === width * height * 4.
 * Structurally identical to ImageData, so the shell passes ImageData in without copying
 * and tests build plain objects.
 */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * An element of the dihedral group D4. Meaning: flip horizontally first (if `flip`),
 * then rotate clockwise `turns` x 90 degrees. Every sequence of the three user
 * operations collapses to one of these 8 values, so the edit never stores history.
 */
export interface Orientation {
  readonly turns: 0 | 1 | 2 | 3;
  readonly flip: boolean;
}

/** Single source of truth for the slider list; UI and message keys derive from it. */
export const ADJUST_KEYS = ["brightness", "contrast", "saturation", "temperature"] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];

/** Integer slider level in [-100, 100]; 0 is neutral. Clamped by `setAdjust`. */
export type Adjust = Readonly<Record<AdjustKey, number>>;

export interface Edit {
  readonly orientation: Orientation;
  readonly adjust: Adjust;
}

export const NEUTRAL_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };
export const IDENTITY_EDIT: Edit = { orientation: { turns: 0, flip: false }, adjust: NEUTRAL_ADJUST };

/** Screen-space operations. Each is a pure Edit -> Edit; the UI never touches Orientation fields. */
export function rotateLeft(edit: Edit): Edit {
  // TODO: turns = (turns + 3) % 4
  throw new Error("not implemented");
}

export function rotateRight(edit: Edit): Edit {
  // TODO: turns = (turns + 1) % 4
  throw new Error("not implemented");
}

export function flipHorizontal(edit: Edit): Edit {
  // TODO: the flip happens on screen, i.e. after the current rotation.
  //   F . R^t . F^f  ==  R^(-t) . F^(f+1)     (because F . R . F == R^-1)
  // so: turns = (4 - turns) % 4, flip = !flip
  throw new Error("not implemented");
}

/** Clamps to [-100, 100] and rounds; the slider input is the only caller and is untrusted text. */
export function setAdjust(edit: Edit, key: AdjustKey, level: number): Edit {
  throw new Error("not implemented");
}

export function resetAdjust(edit: Edit): Edit {
  // TODO: { ...edit, adjust: NEUTRAL_ADJUST }  (orientation is kept; reset is for sliders)
  throw new Error("not implemented");
}

/**
 * The whole edit pipeline, in one pass over destination pixels.
 * Used unchanged for the list thumbnail, the editor preview and the full-resolution export;
 * the only difference between them is the size of `src`.
 * Invariant: render(src, IDENTITY_EDIT) is byte-identical to src (lossless no-op).
 * Alpha is copied untouched.
 */
export function render(src: Pixels, edit: Edit): Pixels {
  // TODO:
  //   const color = isNeutral(edit.adjust) ? null : compileColor(edit.adjust)
  //   const { turns, flip } = edit.orientation
  //   const [W, H] = [src.width, src.height]
  //   const [dw, dh] = turns % 2 ? [H, W] : [W, H]
  //   for dy in 0..dh, dx in 0..dw:
  //     // invert clockwise rotation (CW maps src (x,y) -> (H-1-y, x))
  //     turns 0: x = dx,        y = dy
  //     turns 1: x = dy,        y = H-1-dx
  //     turns 2: x = W-1-dx,    y = H-1-dy
  //     turns 3: x = W-1-dy,    y = dx
  //     if flip: x = W-1-x
  //     copy RGBA from (x,y); if color: apply color to RGB
  throw new Error("not implemented");
}

/**
 * Adjustment compiled once per edit: three 256-entry LUTs plus a saturation factor.
 * Per pixel this costs three lookups and one luma mix, so a 2 MP export stays well under 100 ms.
 */
interface ColorOp {
  readonly lut: readonly [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
  /** 0 = grayscale, 1 = unchanged, 2 = double chroma. */
  readonly saturation: number;
}

function isNeutral(adjust: Adjust): boolean {
  throw new Error("not implemented");
}

function compileColor(adjust: Adjust): ColorOp {
  // TODO: k = level / 100 for each key, in [-1, 1]. Values are gamma-encoded sRGB 0..255;
  // the math is deliberately done in that space (cheap, predictable, matches what users expect
  // from "simple" editors). Order: temperature -> brightness -> contrast (folded into the LUT),
  // then saturation (needs all three channels, so it runs per pixel).
  //
  //   temperature: per-channel gain, warm = more red / less blue.
  //       gainR = 1 + 0.2 * kT,  gainG = 1,  gainB = 1 - 0.2 * kT
  //   brightness: gamma curve, keeps black and white points (no clipping, unlike an offset).
  //       v' = 255 * (v / 255) ^ (2 ^ (-kB))          kB=+1 -> exponent 0.5 (brighter)
  //   contrast: linear around mid-gray, symmetric in log space.
  //       v'' = (v' - 127.5) * 2 ^ (1.5 * kC) + 127.5
  //   lut[c][v] = clamp(round(contrast(brightness(gain[c] * v))))
  //
  //   saturation (per pixel, after LUT):
  //       s = 1 + kS;  luma = 0.299 r + 0.587 g + 0.114 b
  //       r = luma + (r - luma) * s   (same for g, b), then clamp via Uint8ClampedArray
  throw new Error("not implemented");
}
