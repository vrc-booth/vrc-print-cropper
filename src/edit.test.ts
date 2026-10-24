import { describe, expect, it } from "vitest";
import {
  ADJUST_KEYS,
  IDENTITY_EDIT,
  autoAdjust,
  flipHorizontal,
  render,
  resetAdjust,
  rotateLeft,
  rotateRight,
  setAdjust,
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

  it("keeps the orientation when adjustments are reset", () => {
    const src = distinct();
    const rotated = rotateRight(IDENTITY_EDIT);
    const reset = resetAdjust(setAdjust(rotated, "brightness", 40));
    expect([...render(src, reset).data]).toEqual([...render(src, rotated).data]);
  });
});

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

const rgba = (rgb: Rgb, alpha: number): [number, number, number, number] => [rgb[0], rgb[1], rgb[2], alpha];

/** RGB of one pixel after the edit. */
const through = (rgb: Rgb, edit: Edit): Rgb => {
  const out = render(image(1, 1, () => rgba(rgb, 255)), edit).data;
  return [out[0], out[1], out[2]];
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

  it("keeps orientation and saturation, and a second press changes nothing", () => {
    const src = image(64, 1, (i) => [30 + 2 * i, 20 + i, 60 + i, 255]);
    const before = setAdjust(setAdjust(rotateRight(IDENTITY_EDIT), "saturation", 30), "brightness", 80);
    const once = autoAdjust(before, src);
    expect(once.orientation).toEqual(before.orientation);
    expect(once.adjust.saturation).toBe(30);
    expect(autoAdjust(once, src)).toEqual(once);
  });
});
