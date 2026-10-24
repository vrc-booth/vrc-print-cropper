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

/** Single source of truth for the slider list and its order; UI and message keys derive from it. */
export const ADJUST_KEYS = ["exposure", "brightness", "contrast", "blacks", "saturation", "temperature"] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];

/** Integer slider level in [-100, 100]; 0 is neutral. Clamped by `setAdjust`. */
export type Adjust = Readonly<Record<AdjustKey, number>>;

export interface Edit {
  readonly orientation: Orientation;
  readonly adjust: Adjust;
}

export const NEUTRAL_ADJUST: Adjust = { exposure: 0, brightness: 0, contrast: 0, blacks: 0, saturation: 0, temperature: 0 };
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

/** Rounds and clamps; NaN becomes 0. Every caller passes untrusted DOM input. */
function clampInt(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : 0;
}

/** Clamps to [-100, 100] and rounds; the slider input is the only caller and is untrusted text. */
export function setAdjust(edit: Edit, key: AdjustKey, level: number): Edit {
  return { ...edit, adjust: { ...edit.adjust, [key]: clampInt(level, -100, 100) } };
}

export function resetAdjust(edit: Edit): Edit {
  return { ...edit, adjust: NEUTRAL_ADJUST };
}

/** Share of near-neutral pixels needed before a color cast is read as the lighting rather than the scene. */
const MIN_NEUTRAL_SHARE = 0.05;
/** Log-average luma (0–1) below which midtones are lifted. */
const KEY_TARGET = 0.42;

/**
 * Sets every adjust level except saturation from `src`; orientation and saturation stay.
 * Temperature (only when near-neutral pixels are common enough) takes half the level that makes
 * their mean red equal their mean blue, so a world's own lighting survives. Blacks and exposure
 * then move the 0.5th percentile of the darkest channel to 0 and the 99.5th percentile of the
 * brightest to 255, exposure only upward. Brightness lifts a low log-average luma 60% of the way
 * to the target and never darkens. Contrast stays 0.
 * Each step measures `src` through `render` with the steps before it, so the levels fit the
 * same curves the user sees. Previous levels are ignored: pressing it twice changes nothing.
 */
export function autoAdjust(edit: Edit, src: Pixels): Edit {
  const { data } = src;
  const count = data.length / 4;
  let auto = IDENTITY_EDIT;

  const neutral: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    if (max < 250 && min > 15 && (max - min) / max < 0.15) neutral.push(i);
  }
  if (neutral.length >= MIN_NEUTRAL_SHARE * count) {
    let level = 0;
    for (let pass = 0; pass < 4; pass++) {
      const shifted = render(src, setAdjust(IDENTITY_EDIT, "temperature", level)).data;
      let red = 0;
      let blue = 0;
      for (const i of neutral) {
        red += shifted[i];
        blue += shifted[i + 2];
      }
      level = Math.min(100, Math.max(-100, level + (500 * (blue - red)) / (blue + red)));
    }
    auto = setAdjust(auto, "temperature", Math.min(30, Math.max(-30, level * 0.5)));
  }

  const warmed = render(src, auto).data;
  const darkest = new Uint32Array(256);
  const brightest = new Uint32Array(256);
  for (let i = 0; i < warmed.length; i += 4) {
    darkest[Math.min(warmed[i], warmed[i + 1], warmed[i + 2])]++;
    brightest[Math.max(warmed[i], warmed[i + 1], warmed[i + 2])]++;
  }
  const black = percentile(darkest, count, 0.005) / 255;
  if (black > 0) auto = setAdjust(auto, "blacks", (-100 * black) / 0.25);
  const blackPoint = (-0.25 * auto.adjust.blacks) / 100;
  const white = (percentile(brightest, count, 0.995) / 255 - blackPoint) / (1 - blackPoint);
  if (white < 1) auto = setAdjust(auto, "exposure", Math.min(50, 100 * Math.log2(1 / white)));

  const lit = render(src, auto).data;
  let logSum = 0;
  for (let i = 0; i < lit.length; i += 4) logSum += Math.log((0.299 * lit[i] + 0.587 * lit[i + 1] + 0.114 * lit[i + 2] + 1) / 256);
  const key = Math.exp(logSum / count);
  if (key < KEY_TARGET) {
    const goal = Math.exp(Math.log(key) + (Math.log(KEY_TARGET) - Math.log(key)) * 0.6);
    auto = setAdjust(auto, "brightness", Math.min(60, -100 * Math.log2(Math.log(goal) / Math.log(key))));
  }

  return { ...edit, adjust: { ...auto.adjust, saturation: edit.adjust.saturation } };
}

/** The value at sorted index floor(fraction * total): the first level whose running count passes that index. */
function percentile(counts: Uint32Array, total: number, fraction: number): number {
  const rank = Math.floor(fraction * total);
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += counts[level];
    if (seen > rank) return level;
  }
  return 255;
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
  const temperature = 0.2 * k("temperature");
  const blackPoint = -0.25 * k("blacks");
  const gain = 2 ** k("exposure");
  const exponent = 2 ** -k("brightness");
  const slope = 2 ** (1.5 * k("contrast"));
  // A power curve moves the middle and keeps 0 and 1 fixed, so a warm or cool shift never tints white or black.
  const table = (warmth: number): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = (v / 255) ** warmth;
      x = Math.min(1, Math.max(0, (x - blackPoint) / (1 - blackPoint)) * gain);
      x **= exponent;
      out[v] = Math.round(((x - 0.5) * slope + 0.5) * 255);
    }
    return out;
  };
  const lut: ColorOp["lut"] = [table(1 - Math.log2(1 + temperature)), table(1), table(1 - Math.log2(1 - temperature))];
  return { lut, saturation: 1 + k("saturation") };
}

