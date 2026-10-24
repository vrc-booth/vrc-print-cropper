import { describe, expect, it } from "vitest";
import {
  ADJUST_KEYS,
  BLEND_MODES,
  IDENTITY_EDIT,
  NEW_LAYER,
  addLayer,
  autoAdjust,
  autoLayers,
  photoHues,
  flipHorizontal,
  moveLayer,
  removeLayer,
  render,
  resetColor,
  rotateLeft,
  rotateRight,
  setAdjust,
  setLayerColor,
  setLayerMode,
  setLayerOpacity,
  type BlendMode,
  type Edit,
  type Pixels,
} from "./edit";

function image(width: number, height: number, pixel: (i: number) => [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(pixel(i), i * 4);
  return { width, height, data };
}

const distinct = (): Pixels => image(3, 2, (i) => [10 + i, 60 + i, 110 + i, 200 + i]);

type Grid = number[][];

type Op = "right" | "left" | "flip";

const REFERENCE: Record<Op, (g: Grid) => Grid> = {
  right: (g) => g[0].map((_, x) => g.map((row) => row[x]).reverse()),
  left: (g) => g[0].map((_, x) => g.map((row) => row[row.length - 1 - x])),
  flip: (g) => g.map((row) => [...row].reverse()),
};
const OPS: Record<Op, (e: Edit) => Edit> = { right: rotateRight, left: rotateLeft, flip: flipHorizontal };

function sequences(maxLength: number): Op[][] {
  const out: Op[][] = [[]];
  for (let n = 0; n < out.length; n++) {
    if (out[n].length < maxLength) for (const op of Object.keys(OPS) as Op[]) out.push([...out[n], op]);
  }
  return out;
}

describe("render", () => {
  it("leaves pixels byte-identical under the identity edit", () => {
    const src = distinct();
    const out = render(src, IDENTITY_EDIT);
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    expect([...out.data]).toEqual([...src.data]);
  });

  it.each(sequences(4).map((seq) => [seq.join(" ") || "(none)", seq] as const))(
    "orients like the button sequence %s",
    (_, seq) => {
      const src = distinct();
      let grid: Grid = [[0, 1, 2], [3, 4, 5]];
      let edit = IDENTITY_EDIT;
      for (const op of seq) {
        grid = REFERENCE[op](grid);
        edit = OPS[op](edit);
      }
      const out = render(src, edit);
      expect([out.width, out.height]).toEqual([grid[0].length, grid.length]);
      const expected = grid.flat().flatMap((i) => [...src.data.subarray(i * 4, i * 4 + 4)]);
      expect([...out.data]).toEqual(expected);
    },
  );

  it("leaves gray untouched when only saturation moves, so the other sliders at 0 change nothing", () => {
    const gray = image(3, 1, (i) => [40 + 80 * i, 40 + 80 * i, 40 + 80 * i, 255]);
    expect([...render(gray, setAdjust(IDENTITY_EDIT, "saturation", 100)).data]).toEqual([...gray.data]);
  });

  it("makes every pixel gray at saturation -100", () => {
    const out = render(distinct(), setAdjust(IDENTITY_EDIT, "saturation", -100));
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i + 1]).toBe(out.data[i]);
      expect(out.data[i + 2]).toBe(out.data[i]);
    }
  });

  const everything = ADJUST_KEYS.reduce((e, key) => setAdjust(e, key, 70), IDENTITY_EDIT);

  it("never changes alpha", () => {
    const src = distinct();
    const out = render(src, everything);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(src.data[i]);
  });

  it.each([-100, 100])("keeps black and white at brightness %i", (level) => {
    const src = image(2, 1, (i) => (i === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const out = render(src, setAdjust(IDENTITY_EDIT, "brightness", level));
    expect([...out.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("warms gray at temperature +100: more red, less blue", () => {
    const out = render(image(1, 1, () => [128, 128, 128, 255]), setAdjust(IDENTITY_EDIT, "temperature", 100));
    expect(out.data[0]).toBeGreaterThan(128);
    expect(out.data[1]).toBe(128);
    expect(out.data[2]).toBeLessThan(128);
  });

  it("clamps levels to [-100, 100] and treats NaN as neutral", () => {
    const src = distinct();
    const at = (level: number) => [...render(src, setAdjust(IDENTITY_EDIT, "contrast", level)).data];
    expect(at(500)).toEqual(at(100));
    expect(at(-500)).toEqual(at(-100));
    expect(at(Number.NaN)).toEqual([...src.data]);
  });

  it("keeps the orientation when color is reset", () => {
    const src = distinct();
    const rotated = rotateRight(IDENTITY_EDIT);
    const reset = resetColor(setAdjust(rotated, "brightness", 40));
    expect([...render(src, reset).data]).toEqual([...render(src, rotated).data]);
  });
});

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const GRAY: Rgb = [128, 128, 128];

const SAMPLES: Rgb[] = [
  [0, 0, 0],
  [10, 20, 30],
  [128, 128, 128],
  [200, 100, 50],
  [60, 180, 90],
  [255, 255, 255],
];

const rgba = (rgb: Rgb, alpha: number): [number, number, number, number] => [rgb[0], rgb[1], rgb[2], alpha];

const hex = (color: Rgb): string => `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** RGB of one pixel after the edit. */
const through = (rgb: Rgb, edit: Edit): Rgb => {
  const out = render(image(1, 1, () => rgba(rgb, 255)), edit).data;
  return [out[0], out[1], out[2]];
};

/** A gray photo; `stacked` sets every field of the layer `addLayer` gives it. */
const COLORLESS = image(1, 1, () => [128, 128, 128, 255]);

/** `edit` with one more layer on top. */
const stacked = (edit: Edit, mode: BlendMode, color: Rgb, opacity: number): Edit => {
  const top = edit.layers.length;
  return setLayerOpacity(setLayerMode(setLayerColor(addLayer(edit, COLORLESS), top, hex(color)), top, mode), top, opacity);
};

const layered = (mode: BlendMode, color: Rgb, opacity: number): Edit => stacked(IDENTITY_EDIT, mode, color, opacity);

const expectClose = (actual: readonly number[], expected: readonly number[], tolerance: number): void => {
  actual.forEach((value, c) => expect(Math.abs(value - expected[c])).toBeLessThanOrEqual(tolerance));
};

describe("adjustments", () => {
  it("brightens mid-gray at exposure +100 and keeps black", () => {
    const edit = setAdjust(IDENTITY_EDIT, "exposure", 100);
    expect(through([128, 128, 128], edit)[1]).toBeGreaterThan(200);
    expect(through(BLACK, edit)).toEqual(BLACK);
  });

  it("sends dark gray to black at blacks -100 and keeps white", () => {
    const edit = setAdjust(IDENTITY_EDIT, "blacks", -100);
    expect(through([60, 60, 60], edit)).toEqual(BLACK);
    expect(through(WHITE, edit)).toEqual(WHITE);
  });

  it("lifts black at blacks +100", () => {
    expect(through(BLACK, setAdjust(IDENTITY_EDIT, "blacks", 100))[0]).toBeGreaterThan(0);
  });

  it.each([-100, 100])("never tints white or black at temperature %i", (level) => {
    const edit = setAdjust(IDENTITY_EDIT, "temperature", level);
    expect(through(WHITE, edit)).toEqual(WHITE);
    expect(through(BLACK, edit)).toEqual(BLACK);
  });
});

describe("color layer", () => {
  /** The layer color that leaves the photo unchanged, per mode. Modes without one are tested on their own. */
  const NEUTRAL: Partial<Record<BlendMode, Rgb>> = {
    darken: WHITE,
    multiply: WHITE,
    colorBurn: WHITE,
    linearBurn: WHITE,
    divide: WHITE,
    lighten: BLACK,
    screen: BLACK,
    colorDodge: BLACK,
    linearDodge: BLACK,
    subtract: BLACK,
    difference: BLACK,
    exclusion: BLACK,
    overlay: GRAY,
    softLight: GRAY,
    hardLight: GRAY,
    vividLight: GRAY,
    linearLight: GRAY,
    pinLight: GRAY,
  };

  it.each(Object.entries(NEUTRAL) as [BlendMode, Rgb][])("%s with its neutral color changes nothing", (mode, color) => {
    for (const sample of SAMPLES) expectClose(through(sample, layered(mode, color, 100)), sample, 2);
  });

  it("makes every mode a no-op at opacity 0 whatever the color", () => {
    const src = image(SAMPLES.length, 1, (i) => rgba(SAMPLES[i], 17 + i));
    for (const mode of Object.keys(BLEND_MODES) as BlendMode[]) {
      expect([...render(src, layered(mode, [10, 200, 90], 0)).data]).toEqual([...src.data]);
    }
  });

  it("paints the layer color over the photo in normal mode", () => {
    for (const sample of SAMPLES) expect(through(sample, layered("normal", [200, 100, 50], 100))).toEqual([200, 100, 50]);
  });

  it("gives black for multiply with black", () => {
    for (const sample of SAMPLES) expect(through(sample, layered("multiply", BLACK, 100))).toEqual(BLACK);
  });

  it.each(["multiply", "color"] as const)("lands halfway at opacity 50 in %s mode", (mode) => {
    const color: Rgb = [200, 100, 50];
    for (const sample of SAMPLES) {
      const full = through(sample, layered(mode, color, 100));
      expectClose(through(sample, layered(mode, color, 50)), full.map((v, c) => (v + sample[c]) / 2), 1);
    }
  });

  it("never changes alpha", () => {
    const src = image(SAMPLES.length, 1, (i) => rgba(SAMPLES[i], 17 + i));
    for (const mode of Object.keys(BLEND_MODES) as BlendMode[]) {
      const out = render(src, layered(mode, [200, 100, 50], 70));
      for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(src.data[i]);
    }
  });

  it("applies after saturation: a gray layer at full opacity in normal mode survives saturation -100", () => {
    const edit = setAdjust(layered("normal", [200, 100, 50], 100), "saturation", -100);
    expect(through([10, 20, 30], edit)).toEqual([200, 100, 50]);
  });

  it("makes gray stay gray for hue and saturation", () => {
    for (const mode of ["hue", "saturation"] as const) {
      const [r, g, b] = through(GRAY, layered(mode, [255, 0, 0], 100));
      expect([g, b]).toEqual([r, r]);
    }
  });

  it("takes only the layer's luminosity in luminosity mode", () => {
    const [r, g, b] = through([200, 100, 50], layered("luminosity", [100, 100, 100], 100));
    expect(Math.abs(0.3 * r + 0.59 * g + 0.11 * b - 100)).toBeLessThanOrEqual(2);
    const [gr, gg, gb] = through(GRAY, layered("luminosity", [255, 0, 0], 100));
    expect([gg, gb]).toEqual([gr, gr]);
  });

  it("keeps the photo's luminosity with a gray layer in color mode", () => {
    const [r, g, b] = through([200, 100, 50], layered("color", [30, 30, 30], 100));
    expectClose([g, b], [r, r], 1);
    expect(Math.abs(r - (0.299 * 200 + 0.587 * 100 + 0.114 * 50))).toBeLessThanOrEqual(2);
  });

  it.each(["darkerColor", "lighterColor"] as const)("returns exactly the photo or the layer for %s", (mode) => {
    const color: Rgb = [90, 140, 30];
    const total = (rgb: readonly number[]): number => rgb[0] + rgb[1] + rgb[2];
    for (const sample of SAMPLES) {
      const out = through(sample, layered(mode, color, 100));
      const pick = mode === "darkerColor" ? Math.min : Math.max;
      expect(total(out)).toBe(pick(total(sample), total(color)));
      expect([sample, color]).toContainEqual(out);
    }
  });

  it("outputs only 0 or 255 per channel for hardMix", () => {
    for (const sample of SAMPLES) {
      for (const value of through(sample, layered("hardMix", [90, 140, 30], 100))) expect([0, 255]).toContain(value);
    }
  });
});

describe("layer stack", () => {
  it("composites bottom to top", () => {
    const redUnderBlue = stacked(layered("normal", [255, 0, 0], 100), "normal", [0, 0, 255], 100);
    expect(through(GRAY, redUnderBlue)).toEqual([0, 0, 255]);
    expect(through(GRAY, moveLayer(redUnderBlue, 0, 1))).toEqual([255, 0, 0]);
  });

  it("feeds each layer the result of the one below", () => {
    const multiply = layered("multiply", [200, 100, 50], 80);
    const screen = layered("screen", [20, 90, 200], 60);
    const both = stacked(multiply, "screen", [20, 90, 200], 60);
    for (const sample of SAMPLES) expect(through(sample, both)).toEqual(through(through(sample, multiply), screen));
  });

  it("adds new layers on top and removes only the chosen one", () => {
    const two = stacked(layered("multiply", BLACK, 30), "screen", WHITE, 70);
    const three = addLayer(two, COLORLESS).layers;
    expect(three).toHaveLength(3);
    expect(three.slice(0, 2)).toEqual(two.layers);
    expect(removeLayer(two, 0).layers).toEqual([two.layers[1]]);
    expect(removeLayer(two, 1).layers).toEqual([two.layers[0]]);
  });

  it("swaps neighbors on move and changes nothing past either end", () => {
    const two = stacked(layered("multiply", BLACK, 30), "screen", WHITE, 70);
    expect(moveLayer(two, 1, -1).layers).toEqual([two.layers[1], two.layers[0]]);
    expect(moveLayer(two, 0, -1)).toBe(two);
    expect(moveLayer(two, 1, 1)).toBe(two);
  });

  it("changes only the chosen layer", () => {
    const two = stacked(layered("multiply", BLACK, 30), "screen", WHITE, 70);
    const changed = setLayerOpacity(setLayerMode(setLayerColor(two, 0, "#102030"), 0, "hue"), 0, 90);
    expect(changed.layers[0]).toEqual({ color: [16, 32, 48], mode: "hue", opacity: 90 });
    expect(changed.layers[1]).toBe(two.layers[1]);
  });
});

describe("automatic layers", () => {
  type Px = [number, number, number, number];
  /** 70 blue pixels, 30 red, 50 gray: mid-bright. */
  const photo = image(150, 1, (i) => (i < 70 ? [30, 60, 200, 255] : i < 100 ? [210, 40, 40, 255] : [128, 128, 128, 255]));
  /** Vivid blue, red and green in equal parts: no main hue, colored shadows, no black. */
  const balanced = image(90, 1, (i) => [[40, 80, 230, 255], [230, 50, 50, 255], [50, 200, 60, 255]][i % 3] as Px);
  /** `share` of the pixels pure black, the rest balanced. */
  const crushed = (share: number) => image(100, 1, (i) => (i < 100 * share ? [0, 0, 0, 255] : ([[40, 80, 230, 255], [230, 50, 50, 255], [50, 200, 60, 255]][i % 3] as Px)));
  const degrees = (hue: number): number => Math.round(((hue * 180) / Math.PI + 360) % 360);
  const hueOf = ([r, g, b]: readonly number[]): string => (b > r && b > g ? "blue" : r > g && r > b ? "red" : "other");
  const modes = (edit: Edit): string[] => edit.layers.map((layer) => layer.mode);

  it("orders the photo's hues by how much of the photo's color they hold", () => {
    const [blue, red] = photoHues(photo);
    expect(degrees(blue.hue)).toBeGreaterThan(200);
    expect(degrees(blue.hue)).toBeLessThan(250);
    expect(Math.min(degrees(red.hue), 360 - degrees(red.hue))).toBeLessThan(15);
    expect(blue.share).toBeGreaterThan(red.share);
    expect(blue.share + red.share).toBeCloseTo(1);
  });

  it("keeps close hues as one", () => {
    expect(photoHues(image(100, 1, (i) => (i % 2 ? [30, 60, 200, 255] : [30, 80, 200, 255])))).toHaveLength(1);
  });

  it("ignores gray, dark and washed-out pixels", () => {
    expect(photoHues(image(3, 1, (i) => [[128, 128, 128, 255], [40, 10, 10, 255], [250, 240, 240, 255]][i] as Px))).toEqual([]);
  });

  it("adds nothing to a photo that needs nothing", () => {
    expect(autoLayers(IDENTITY_EDIT, balanced).layers).toEqual([]);
  });

  it("tints a photo whose color is mostly one hue with that hue", () => {
    const blue = autoLayers(IDENTITY_EDIT, image(10, 1, () => [40, 80, 230, 255])).layers;
    expect(blue.map((layer) => [layer.mode, hueOf(layer.color)])).toEqual([["softLight", "blue"]]);
  });

  it("deepens washed-out colors with color burn", () => {
    expect(modes(autoLayers(IDENTITY_EDIT, image(10, 1, () => [200, 185, 175, 255])))).toContain("colorBurn");
  });

  it("tones gray shadows with a dark version of the opposite hue", () => {
    const orange = image(10, 1, (i) => (i < 5 ? [60, 60, 60, 255] : [230, 120, 30, 255]));
    const shadow = autoLayers(IDENTITY_EDIT, orange).layers.find((layer) => layer.mode === "softLight" && Math.max(...layer.color) < 128);
    expect(shadow && hueOf(shadow.color)).toBe("blue");
  });

  it("opens crushed shadows, the more of them the stronger", () => {
    const lift = (share: number) => autoLayers(IDENTITY_EDIT, crushed(share)).layers.find((layer) => layer.mode === "screen");
    expect(autoLayers(IDENTITY_EDIT, crushed(0)).layers.find((layer) => layer.mode === "screen")).toBeUndefined();
    expect(lift(0.1)!.opacity).toBeGreaterThanOrEqual(10);
    expect(lift(0.2)!.opacity).toBeGreaterThan(lift(0.1)!.opacity);
  });

  it("replaces every layer, so pressing it again changes nothing", () => {
    const mine = stacked(IDENTITY_EDIT, "multiply", [10, 20, 30], 50);
    const auto = autoLayers(mine, photo);
    expect(auto.layers).toEqual(autoLayers(IDENTITY_EDIT, photo).layers);
    expect(autoLayers(auto, photo)).toEqual(auto);
  });

  it("measures the photo as adjusted", () => {
    const dull = image(10, 1, () => [180, 150, 140, 255]);
    expect(modes(autoLayers(IDENTITY_EDIT, dull))).toContain("colorBurn");
    expect(modes(autoLayers(setAdjust(IDENTITY_EDIT, "saturation", 100), dull))).not.toContain("colorBurn");
  });

  it("adds the planned layers one at a time, then tints with the photo's hues, then NEW_LAYER without any", () => {
    const planned = autoLayers(IDENTITY_EDIT, photo).layers;
    let edit = IDENTITY_EDIT;
    for (let i = 0; i < planned.length; i++) edit = addLayer(edit, photo);
    expect(edit.layers).toEqual(planned);
    const next = addLayer(edit, photo).layers.at(-1)!;
    expect(next.mode).toBe("softLight");
    expect(["blue", "red"]).toContain(hueOf(next.color));

    const gray = image(1, 1, () => [128, 128, 128, 255]);
    const full = autoLayers(IDENTITY_EDIT, gray);
    expect(addLayer(full, gray).layers.at(-1)).toEqual(NEW_LAYER);
  });

  it("skips a planned layer the photo already has", () => {
    const dark = crushed(0.3);
    const planned = autoLayers(IDENTITY_EDIT, dark).layers;
    expect(planned).toHaveLength(2);
    const second = { ...IDENTITY_EDIT, layers: [planned[1]] };
    expect(addLayer(second, dark).layers).toEqual([planned[1], planned[0]]);
  });
});

describe("transitions", () => {
  const one = addLayer(IDENTITY_EDIT, COLORLESS);

  it("accepts only #rrggbb layer colors, in either case", () => {
    expect(setLayerColor(one, 0, "#FFa040").layers[0].color).toEqual([255, 160, 64]);
    expect(setLayerColor(one, 0, "#0a0b0c").layers[0].color).toEqual([10, 11, 12]);
    for (const bad of ["red", "#12345", "#gggggg", "#1234567", "123456"]) expect(setLayerColor(one, 0, bad)).toBe(one);
  });

  it("accepts only blend modes from the registry", () => {
    expect(setLayerMode(one, 0, "multiply").layers[0].mode).toBe("multiply");
    for (const bad of ["hue ", "dissolve", "toString", "__proto__"]) expect(setLayerMode(one, 0, bad)).toBe(one);
  });

  it("clamps and rounds opacity, and treats NaN as 0", () => {
    const at = (level: number): number => setLayerOpacity(one, 0, level).layers[0].opacity;
    expect([at(150), at(-5), at(Number.NaN), at(33.6)]).toEqual([100, 0, 0, 34]);
  });

  it("clears adjustments and layers on reset but keeps the orientation", () => {
    const messy = addLayer(setAdjust(rotateRight(IDENTITY_EDIT), "contrast", 40), COLORLESS);
    const reset = resetColor(messy);
    expect(reset.adjust).toEqual(IDENTITY_EDIT.adjust);
    expect(reset.layers).toEqual([]);
    expect(reset.orientation).toEqual(messy.orientation);
  });
});

describe("autoAdjust", () => {
  const gray = (values: readonly number[]): Pixels => image(values.length, 1, (i) => [values[i], values[i], values[i], 255]);
  const ramp = (count: number, from: number, to: number): number[] =>
    Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
  /** A photo with a sliver of clipped black and white, so its 0.5th and 99.5th percentiles are 0 and 255. */
  const clipped = (body: readonly number[]): number[] => [...Array<number>(6).fill(0), ...body, ...Array<number>(6).fill(255)];

  const luma = (data: Uint8ClampedArray, i: number): number => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const logAverage = (px: Pixels): number => {
    let sum = 0;
    for (let i = 0; i < px.data.length; i += 4) sum += Math.log((luma(px.data, i) + 1) / 256);
    return Math.exp(sum / (px.data.length / 4));
  };
  const span = (px: Pixels): number => {
    const levels: number[] = [];
    for (let i = 0; i < px.data.length; i += 4) levels.push(luma(px.data, i));
    levels.sort((a, b) => a - b);
    return levels[Math.floor(0.995 * levels.length)] - levels[Math.floor(0.005 * levels.length)];
  };
  const mean = (px: Pixels, channel: number): number => {
    let sum = 0;
    for (let i = channel; i < px.data.length; i += 4) sum += px.data[i];
    return sum / (px.data.length / 4);
  };

  it("leaves a well-exposed full-range neutral image within two levels", () => {
    const { adjust } = autoAdjust(IDENTITY_EDIT, gray(clipped(ramp(988, 40, 250))));
    for (const key of ADJUST_KEYS) expect(Math.abs(adjust[key])).toBeLessThanOrEqual(2);
  });

  it("brightens a dark image partway without reaching mid-gray", () => {
    const dark = gray(clipped(ramp(988, 0, 1).map((v) => 255 * v ** 3)));
    const edit = autoAdjust(IDENTITY_EDIT, dark);
    expect(edit.adjust.brightness).toBeGreaterThan(0);
    const before = logAverage(dark);
    const after = logAverage(render(dark, edit));
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(0.5);
  });

  it("never darkens a bright image", () => {
    const { adjust } = autoAdjust(IDENTITY_EDIT, gray(ramp(256, 170, 254)));
    expect(adjust.exposure).toBeGreaterThanOrEqual(0);
    expect(adjust.brightness).toBeGreaterThanOrEqual(0);
  });

  it("widens a hazy image by lowering blacks and raising exposure", () => {
    const hazy = gray(ramp(256, 60, 190));
    const edit = autoAdjust(IDENTITY_EDIT, hazy);
    expect(edit.adjust.blacks).toBeLessThan(0);
    expect(edit.adjust.exposure).toBeGreaterThan(0);
    expect(span(render(hazy, edit))).toBeGreaterThan(span(hazy) + 20);
  });

  it("removes about half of a warm cast on near-neutral pixels", () => {
    const warm = image(141, 1, (i) => [70 + i + 10, 70 + i, 70 + i - 10, 255]);
    const edit = autoAdjust(IDENTITY_EDIT, warm);
    expect(edit.adjust.temperature).toBeLessThan(0);
    const cast = (px: Pixels): number => (mean(px, 0) - mean(px, 2)) / (mean(px, 0) + mean(px, 2));
    const kept = cast(render(warm, setAdjust(IDENTITY_EDIT, "temperature", edit.adjust.temperature))) / cast(warm);
    expect(kept).toBeGreaterThan(0.3);
    expect(kept).toBeLessThan(0.7);
  });

  it("leaves temperature alone when no pixel is near-neutral", () => {
    const vivid = image(60, 1, (i) => [[220, 30, 30, 255], [30, 220, 30, 255], [30, 30, 220, 255]][i % 3] as [number, number, number, number]);
    expect(autoAdjust(IDENTITY_EDIT, vivid).adjust.temperature).toBe(0);
  });

  it("keeps orientation, saturation and layers, and a second press changes nothing", () => {
    const src = image(64, 1, (i) => [30 + 2 * i, 20 + i, 60 + i, 255]);
    const before = stacked(setAdjust(setAdjust(rotateRight(IDENTITY_EDIT), "saturation", 30), "brightness", 80), "multiply", GRAY, 40);
    const once = autoAdjust(before, src);
    expect(once.orientation).toEqual(before.orientation);
    expect(once.layers).toEqual(before.layers);
    expect(once.adjust.saturation).toBe(30);
    expect(autoAdjust(once, src)).toEqual(once);
  });
});
