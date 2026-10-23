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
  return turn(edit, 3);
}

export function rotateRight(edit: Edit): Edit {
  return turn(edit, 1);
}

export function flipHorizontal(edit: Edit): Edit {
  const { turns, flip } = edit.orientation;
  return { ...edit, orientation: { turns: ((4 - turns) % 4) as Orientation["turns"], flip: !flip } };
}

function turn(edit: Edit, quarterTurns: 1 | 3): Edit {
  const { turns, flip } = edit.orientation;
  return { ...edit, orientation: { turns: ((turns + quarterTurns) % 4) as Orientation["turns"], flip } };
}

/** Clamps to [-100, 100] and rounds; the slider input is the only caller and is untrusted text. */
export function setAdjust(edit: Edit, key: AdjustKey, level: number): Edit {
  const clamped = Number.isFinite(level) ? Math.round(Math.min(100, Math.max(-100, level))) : 0;
  return { ...edit, adjust: { ...edit.adjust, [key]: clamped } };
}

export function resetAdjust(edit: Edit): Edit {
  return { ...edit, adjust: NEUTRAL_ADJUST };
}

/**
 * The whole edit pipeline, in one pass over destination pixels.
 * Used unchanged for the list thumbnail, the editor preview and the full-resolution export;
 * the only difference between them is the size of `src`.
 * Invariant: render(src, IDENTITY_EDIT) is byte-identical to src (lossless no-op).
 * Alpha is copied untouched.
 */
export function render(src: Pixels, edit: Edit): Pixels {
  const color = isNeutral(edit.adjust) ? null : compileColor(edit.adjust);
  const { turns, flip } = edit.orientation;
  const { width: w, height: h, data: from } = src;
  const [dw, dh] = turns % 2 ? [h, w] : [w, h];
  const data = new Uint8ClampedArray(dw * dh * 4);
  let o = 0;
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++, o += 4) {
      let x: number;
      let y: number;
      if (turns === 0) [x, y] = [dx, dy];
      else if (turns === 1) [x, y] = [dy, h - 1 - dx];
      else if (turns === 2) [x, y] = [w - 1 - dx, h - 1 - dy];
      else [x, y] = [w - 1 - dy, dx];
      if (flip) x = w - 1 - x;
      const i = (y * w + x) * 4;
      if (color) {
        const [lr, lg, lb] = color.lut;
        const r = lr[from[i]];
        const g = lg[from[i + 1]];
        const b = lb[from[i + 2]];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        data[o] = luma + (r - luma) * color.saturation;
        data[o + 1] = luma + (g - luma) * color.saturation;
        data[o + 2] = luma + (b - luma) * color.saturation;
      } else {
        data[o] = from[i];
        data[o + 1] = from[i + 1];
        data[o + 2] = from[i + 2];
      }
      data[o + 3] = from[i + 3];
    }
  }
  return { width: dw, height: dh, data };
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
  return ADJUST_KEYS.every((key) => adjust[key] === 0);
}

function compileColor(adjust: Adjust): ColorOp {
  const k = (key: AdjustKey): number => adjust[key] / 100;
  const exponent = 2 ** -k("brightness");
  const slope = 2 ** (1.5 * k("contrast"));
  const temperature = 0.2 * k("temperature");
  const table = (gain: number): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const bright = 255 * (Math.min(255, gain * v) / 255) ** exponent;
      out[v] = Math.round((bright - 127.5) * slope + 127.5);
    }
    return out;
  };
  const lut: ColorOp["lut"] = [table(1 + temperature), table(1), table(1 - temperature)];
  return { lut, saturation: 1 + k("saturation") };
}
