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

/** Channels in [0, 1]. */
type Rgb = readonly [number, number, number];

/**
 * How a layer color combines with the photo. A separable mode treats each channel alone, so it
 * compiles to one 256-entry table per channel. A pixel mode reads all three channels of both
 * colors (hue, luminosity, whole-pixel comparisons), so it runs per pixel.
 * Separable results may leave [0, 1]; the compiled table clamps them.
 */
type Blend =
  | { readonly kind: "channel"; readonly blend: (base: number, layer: number) => number }
  | { readonly kind: "pixel"; readonly blend: (base: Rgb, layer: Rgb) => Rgb };

const channel = (blend: (base: number, layer: number) => number): Blend => ({ kind: "channel", blend });
const pixel = (blend: (base: Rgb, layer: Rgb) => Rgb): Blend => ({ kind: "pixel", blend });

const colorBurn = (b: number, s: number): number => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const colorDodge = (b: number, s: number): number => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
const screen = (b: number, s: number): number => 1 - (1 - b) * (1 - s);
const hardLight = (b: number, s: number): number => (s <= 0.5 ? 2 * b * s : screen(b, 2 * s - 1));
/** W3C Compositing and Blending Level 1, soft-light. */
const softLight = (b: number, s: number): number =>
  s <= 0.5
    ? b - (1 - 2 * s) * b * (1 - b)
    : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b);

// Non-separable helpers from the same spec (luma weights 0.3, 0.59, 0.11).
// These run once per pixel, so they avoid spread arguments; with them the hue mode took ~150 ms per 1280x720 preview.
const lum = (c: Rgb): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const max3 = (c: Rgb): number => (c[0] > c[1] ? (c[0] > c[2] ? c[0] : c[2]) : c[1] > c[2] ? c[1] : c[2]);
const min3 = (c: Rgb): number => (c[0] < c[1] ? (c[0] < c[2] ? c[0] : c[2]) : c[1] < c[2] ? c[1] : c[2]);
const sat = (c: Rgb): number => max3(c) - min3(c);
const sum = (c: Rgb): number => c[0] + c[1] + c[2];
const setSat = (c: Rgb, s: number): Rgb => {
  const min = min3(c);
  const range = max3(c) - min;
  if (range <= 0) return [0, 0, 0];
  const k = s / range;
  return [(c[0] - min) * k, (c[1] - min) * k, (c[2] - min) * k];
};
const setLum = (c: Rgb, l: number): Rgb => {
  const d = l - lum(c);
  const r = c[0] + d;
  const g = c[1] + d;
  const b = c[2] + d;
  const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
  const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
  if (lo < 0) {
    const k = l / (l - lo);
    return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k];
  }
  if (hi > 1) {
    const k = (1 - l) / (hi - l);
    return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k];
  }
  return [r, g, b];
};

/**
 * Photoshop's blend modes minus Dissolve, whose random noise would differ between thumbnail,
 * preview and export. Key order is the order of the UI list.
 */
export const BLEND_MODES = {
  normal: channel((_, s) => s),
  darken: channel(Math.min),
  multiply: channel((b, s) => b * s),
  colorBurn: channel(colorBurn),
  linearBurn: channel((b, s) => b + s - 1),
  darkerColor: pixel((b, s) => (sum(s) < sum(b) ? s : b)),
  lighten: channel(Math.max),
  screen: channel(screen),
  colorDodge: channel(colorDodge),
  linearDodge: channel((b, s) => b + s),
  lighterColor: pixel((b, s) => (sum(s) > sum(b) ? s : b)),
  overlay: channel((b, s) => hardLight(s, b)),
  softLight: channel(softLight),
  hardLight: channel(hardLight),
  vividLight: channel((b, s) => (s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * s - 1))),
  linearLight: channel((b, s) => b + 2 * s - 1),
  pinLight: channel((b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1))),
  hardMix: channel((b, s) => (b + s >= 1 ? 1 : 0)),
  difference: channel((b, s) => Math.abs(b - s)),
  exclusion: channel((b, s) => b + s - 2 * b * s),
  subtract: channel((b, s) => b - s),
  divide: channel((b, s) => (s <= 0 ? 1 : b / s)),
  hue: pixel((b, s) => setLum(setSat(s, sat(b)), lum(b))),
  saturation: pixel((b, s) => setLum(setSat(b, sat(s)), lum(b))),
  color: pixel((b, s) => setLum(s, lum(b))),
  luminosity: pixel((b, s) => setLum(b, lum(s))),
} satisfies Record<string, Blend>;
export type BlendMode = keyof typeof BLEND_MODES;

/** A solid color composited over the adjusted photo, after saturation. Opacity is an integer in [0, 100]. */
export interface Layer {
  readonly color: readonly [number, number, number];
  readonly mode: BlendMode;
  readonly opacity: number;
}

export interface Edit {
  readonly orientation: Orientation;
  readonly adjust: Adjust;
  /** Bottom to top: layers[0] is composited first. */
  readonly layers: readonly Layer[];
}

export const NEUTRAL_ADJUST: Adjust = { exposure: 0, brightness: 0, contrast: 0, blacks: 0, saturation: 0, temperature: 0 };
/** What `addLayer` puts on top of a photo without any hue. */
export const NEW_LAYER: Layer = { color: [255, 160, 64], mode: "softLight", opacity: 50 };
export const IDENTITY_EDIT: Edit = { orientation: { turns: 0, flip: false }, adjust: NEUTRAL_ADJUST, layers: [] };

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

/**
 * Replaces every layer with the ones this photo needs (`planLayers`). It measures the photo as
 * adjusted so far with layers left out, so pressing it again changes nothing.
 */
export function autoLayers(edit: Edit, src: Pixels): Edit {
  return { ...edit, layers: planLayers(render(src, { ...edit, layers: [] })) };
}

/**
 * Adds the first layer `autoLayers` would set that is not on the photo yet. Once all of those are
 * there, it adds soft light tints of the photo's hues in turn, or NEW_LAYER when the photo has none.
 */
export function addLayer(edit: Edit, src: Pixels): Edit {
  const photo = render(src, { ...edit, layers: [] });
  const has = (layer: Layer): boolean =>
    edit.layers.some((l) => l.mode === layer.mode && l.opacity === layer.opacity && l.color.every((c, i) => c === layer.color[i]));
  const hues = photoHues(photo);
  const layer =
    planLayers(photo).find((l) => !has(l)) ??
    (hues.length === 0 ? NEW_LAYER : { color: hsvToRgb(hues[edit.layers.length % hues.length].hue, 0.6, 1), mode: "softLight", opacity: 40 });
  return { ...edit, layers: [...edit.layers, layer] };
}

/** A hue is the photo's main color when it holds at least this share of all color. */
const DOMINANT_SHARE = 0.5;
/** Mean saturation (0–1) of lit pixels below which colors count as washed out. */
const DULL = 0.3;
/** Saturation of the shadows' mean color below which shadows count as neutral gray. */
const NEUTRAL = 0.1;
/** The darkest share of pixels taken as the shadows. */
const SHADOW_SHARE = 0.3;
/** Luma 10/255: darker pixels show no detail on a typical display. */
const BLACK = 10 / 255;
/** Share of pixels darker than BLACK above which shadows count as crushed. */
const CRUSHED = 0.02;
/** Hue for photos without one: warm light, so the shadows get the cool opposite. */
const WARM = Math.PI / 6;

/**
 * The layers this photo needs, bottom first. Each answers one measured need and its opacity grows
 * with that need from 10%, the least that shows, so a photo that needs none gets none:
 * - one hue holds most of the color: a soft light tint of it pulls the rest of the picture together,
 *   kept light because it also deepens the cast the photo already has;
 * - colors are washed out: a light color burn of the main hue deepens and saturates them;
 * - shadows are neutral gray: a dark soft light of the opposite hue colors them without lifting black;
 * - shadows are crushed to black: a dark, grayish screen of the main hue opens them; the opposite
 *   hue would turn black into its color.
 * The opposite hue is the photo's own hue when one lies within 60 degrees of it, so the toning
 * follows the color contrast the photo already has.
 */
function planLayers(photo: Pixels): Layer[] {
  const { hues, saturation, shadowSaturation, crushed } = measure(photo);
  const main = hues[0];
  const hue = main?.hue ?? WARM;
  const opposite = hues.find((h) => hueDistance(h.hue, hue + Math.PI) < Math.PI / 3)?.hue ?? hue + Math.PI;
  const layers: Layer[] = [];
  if (main && main.share >= DOMINANT_SHARE) layers.push({ color: hsvToRgb(hue, 0.6, 1), mode: "softLight", opacity: Math.round(10 + (10 * (main.share - DOMINANT_SHARE)) / (1 - DOMINANT_SHARE)) });
  if (saturation < DULL) layers.push({ color: hsvToRgb(hue, 0.3, 1), mode: "colorBurn", opacity: Math.round(10 + 30 * (1 - saturation / DULL)) });
  if (shadowSaturation < NEUTRAL) {
    layers.push({ color: hsvToRgb(opposite, 0.7, 0.35), mode: "softLight", opacity: Math.round(15 + 20 * (1 - shadowSaturation / NEUTRAL)) });
  }
  if (crushed > CRUSHED) layers.push({ color: hsvToRgb(hue, 0.4, 0.45), mode: "screen", opacity: Math.round(Math.min(30, 10 + 100 * (crushed - CRUSHED))) });
  return layers;
}

function hueDistance(a: number, b: number): number {
  const d = (((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
}

interface Look {
  readonly hues: ReadonlyArray<{ readonly hue: number; readonly share: number }>;
  /** Mean HSV saturation of pixels at least MIN_CHROMA bright; darker ones carry no reliable color. */
  readonly saturation: number;
  /** HSV saturation of the mean color of the darkest SHADOW_SHARE of pixels. */
  readonly shadowSaturation: number;
  /** Share of pixels darker than BLACK. */
  readonly crushed: number;
}

function measure(photo: Pixels): Look {
  const { data } = photo;
  const count = data.length / 4;
  const luma = new Float64Array(count);
  let saturationSum = 0;
  let lit = 0;
  let crushed = 0;
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    luma[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    if (luma[p] < BLACK) crushed++;
    if (max / 255 >= MIN_CHROMA) {
      saturationSum += (max - Math.min(data[i], data[i + 1], data[i + 2])) / max;
      lit++;
    }
  }
  const cut = luma.slice().sort()[Math.floor(SHADOW_SHARE * (count - 1))];
  const mean = [0, 0, 0];
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    if (luma[p] > cut) continue;
    for (let c = 0; c < 3; c++) mean[c] += data[i + c];
  }
  const max = Math.max(...mean);
  return {
    hues: photoHues(photo),
    saturation: lit === 0 ? 0 : saturationSum / lit,
    shadowSaturation: max === 0 ? 0 : (max - Math.min(...mean)) / max,
    crushed: crushed / count,
  };
}

const HUE_BINS = 36;
/** Pixels below this saturation or brightness (0–1) carry too little hue to count. */
const MIN_CHROMA = 0.25;
/** A hue needs this share of all counted weight to become a color. */
const MIN_HUE_SHARE = 0.04;
/** Two picked hues are at least this many bins (10 degrees each) apart. */
const HUE_GAP = 3;
const MAX_COLORS = 4;

/**
 * The photo's main hues in radians, most common first: at most four, at least 30 degrees apart, each
 * with its share of all color, counting every hue toward the nearest picked one. Each pixel votes for its hue with weight saturation x brightness, so
 * vivid colors decide and gray, dark and washed-out pixels do not.
 */
export function photoHues(src: Pixels): Array<{ hue: number; share: number }> {
  const { data } = src;
  const weight = new Float64Array(HUE_BINS);
  const cos = new Float64Array(HUE_BINS);
  const sin = new Float64Array(HUE_BINS);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const range = max - Math.min(r, g, b);
    const saturation = max === 0 ? 0 : range / max;
    const value = max / 255;
    if (saturation < MIN_CHROMA || value < MIN_CHROMA) continue;
    const sector = max === r ? (g - b) / range : max === g ? 2 + (b - r) / range : 4 + (r - g) / range;
    const hue = (((sector * Math.PI) / 3) + 2 * Math.PI) % (2 * Math.PI);
    const bin = Math.min(HUE_BINS - 1, Math.floor((hue / (2 * Math.PI)) * HUE_BINS));
    const w = saturation * value;
    weight[bin] += w;
    cos[bin] += w * Math.cos(hue);
    sin[bin] += w * Math.sin(hue);
    total += w;
  }

  const picked: number[] = [];
  const order = [...weight.keys()].sort((a, b) => weight[b] - weight[a]);
  for (const bin of order) {
    if (picked.length === MAX_COLORS || weight[bin] === 0 || weight[bin] < MIN_HUE_SHARE * total) break;
    const apart = picked.every((p) => {
      const gap = Math.abs(p - bin);
      return Math.min(gap, HUE_BINS - gap) >= HUE_GAP;
    });
    if (apart) picked.push(bin);
  }
  const share = picked.map(() => 0);
  for (const bin of weight.keys()) {
    const gaps = picked.map((p) => Math.min(Math.abs(p - bin), HUE_BINS - Math.abs(p - bin)));
    share[gaps.indexOf(Math.min(...gaps))] += weight[bin] / total;
  }
  return picked.map((bin, n) => ({ hue: Math.atan2(sin[bin], cos[bin]), share: share[n] }));
}

/** Hue in radians, saturation and value in [0, 1]. */
function hsvToRgb(hue: number, saturation: number, value: number): readonly [number, number, number] {
  const h = ((((hue * 3) / Math.PI) % 6) + 6) % 6;
  const channel = (n: number): number => {
    const k = (n + h) % 6;
    return Math.round(255 * value * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [channel(5), channel(3), channel(1)];
}

export function removeLayer(edit: Edit, index: number): Edit {
  return { ...edit, layers: edit.layers.filter((_, i) => i !== index) };
}

/** Swaps a layer with the one above (+1) or below (-1); at either end the edit stays unchanged. */
export function moveLayer(edit: Edit, index: number, step: 1 | -1): Edit {
  const to = index + step;
  if (Math.min(index, to) < 0 || Math.max(index, to) >= edit.layers.length) return edit;
  const layers = [...edit.layers];
  [layers[index], layers[to]] = [layers[to], layers[index]];
  return { ...edit, layers };
}

/** Accepts only `#rrggbb`; anything else leaves the edit unchanged. */
export function setLayerColor(edit: Edit, index: number, hex: string): Edit {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return edit;
  const value = parseInt(hex.slice(1), 16);
  return changeLayer(edit, index, { color: [value >> 16, (value >> 8) & 255, value & 255] });
}

/** Accepts only keys of `BLEND_MODES`; anything else leaves the edit unchanged. */
export function setLayerMode(edit: Edit, index: number, mode: string): Edit {
  return Object.hasOwn(BLEND_MODES, mode) ? changeLayer(edit, index, { mode: mode as BlendMode }) : edit;
}

/** Clamps to [0, 100] and rounds. */
export function setLayerOpacity(edit: Edit, index: number, level: number): Edit {
  return changeLayer(edit, index, { opacity: clampInt(level, 0, 100) });
}

function changeLayer(edit: Edit, index: number, change: Partial<Layer>): Edit {
  return { ...edit, layers: edit.layers.map((layer, i) => (i === index ? { ...layer, ...change } : layer)) };
}

/** Neutral adjustments and no layers; orientation stays. */
export function resetColor(edit: Edit): Edit {
  return { ...edit, adjust: NEUTRAL_ADJUST, layers: [] };
}

/** Share of near-neutral pixels needed before a color cast is read as the lighting rather than the scene. */
const MIN_NEUTRAL_SHARE = 0.05;
/** Log-average luma (0–1) below which midtones are lifted. */
const KEY_TARGET = 0.42;

/**
 * Sets every adjust level except saturation from `src`; orientation, saturation and layers stay.
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

  const key = logAverageLuma(render(src, auto));
  if (key < KEY_TARGET) {
    const goal = Math.exp(Math.log(key) + (Math.log(KEY_TARGET) - Math.log(key)) * 0.6);
    auto = setAdjust(auto, "brightness", Math.min(60, -100 * Math.log2(Math.log(goal) / Math.log(key))));
  }

  return { ...edit, adjust: { ...auto.adjust, saturation: edit.adjust.saturation } };
}

/** Geometric mean of luma in (0, 1]: how bright the photo looks, without a few highlights pulling it up. */
function logAverageLuma({ data }: Pixels): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += Math.log((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] + 1) / 256);
  return Math.exp(sum / (data.length / 4));
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
  const color = isNeutral(edit.adjust) && edit.layers.every((layer) => layer.opacity === 0) ? null : compileColor(edit);
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
        for (const tint of color.tints) tint(data, o);
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

/** Rewrites the RGB at `data[offset..offset + 2]` in place with the layer composited over it. */
type Tint = (data: Uint8ClampedArray, offset: number) => void;

/**
 * Color edit compiled once per render: three 256-entry LUTs, a saturation factor and the layers.
 * Per pixel this costs three lookups, one luma mix and one tint per layer. A pixel-kind layer mode
 * costs more: 30–45 ms for a 1280x720 preview in Chromium, against about 25 ms for a table-only edit.
 */
interface ColorOp {
  readonly lut: readonly [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
  /** 0 = grayscale, 1 = unchanged, 2 = double chroma. */
  readonly saturation: number;
  /** Bottom to top; layers at opacity 0 are left out. */
  readonly tints: readonly Tint[];
}

function isNeutral(adjust: Adjust): boolean {
  return ADJUST_KEYS.every((key) => adjust[key] === 0);
}

function compileColor({ adjust, layers }: Edit): ColorOp {
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
  return { lut, saturation: 1 + k("saturation"), tints: layers.filter((layer) => layer.opacity > 0).map(compileTint) };
}

function compileTint({ color, mode, opacity }: Layer): Tint {
  const blend = BLEND_MODES[mode];
  const amount = opacity / 100;
  if (blend.kind === "pixel") {
    const layer: Rgb = [color[0] / 255, color[1] / 255, color[2] / 255];
    return (data, o) => {
      const base: Rgb = [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255];
      const mixed = blend.blend(base, layer);
      data[o] = 255 * (base[0] + (mixed[0] - base[0]) * amount);
      data[o + 1] = 255 * (base[1] + (mixed[1] - base[1]) * amount);
      data[o + 2] = 255 * (base[2] + (mixed[2] - base[2]) * amount);
    };
  }
  const table = (c: number): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const base = v / 255;
      const blended = Math.min(1, Math.max(0, blend.blend(base, c / 255)));
      out[v] = Math.round(255 * (base + (blended - base) * amount));
    }
    return out;
  };
  const [tr, tg, tb] = [table(color[0]), table(color[1]), table(color[2])];
  return (data, o) => {
    data[o] = tr[data[o]];
    data[o + 1] = tg[data[o + 1]];
    data[o + 2] = tb[data[o + 2]];
  };
}
