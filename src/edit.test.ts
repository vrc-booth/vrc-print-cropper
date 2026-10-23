import { describe, expect, it } from "vitest";
import {
  IDENTITY_EDIT,
  flipHorizontal,
  render,
  rotateLeft,
  resetAdjust,
  rotateRight,
  setAdjust,
  ADJUST_KEYS,
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
