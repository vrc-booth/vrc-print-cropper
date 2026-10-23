import { describe, expect, it } from "vitest";
import { IDENTITY_EDIT, rotateRight } from "./edit";
import { exportSource, openSource } from "./source";

const PHOTO = { x: 64, y: 69, width: 1920, height: 1080 };

function pattern(width: number, height: number): ImageData {
  const image = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      image.data.set([x & 255, y & 255, (x >> 8) | ((y >> 8) << 3), 255], (y * width + x) * 4);
    }
  }
  return image;
}

function print(): ImageData {
  const image = new ImageData(2048, 1440);
  image.data.fill(255);
  const photo = pattern(PHOTO.width, PHOTO.height);
  for (let y = 0; y < PHOTO.height; y++) {
    const row = photo.data.subarray(y * PHOTO.width * 4, (y + 1) * PHOTO.width * 4);
    image.data.set(row, ((PHOTO.y + y) * 2048 + PHOTO.x) * 4);
  }
  return image;
}

async function encode(image: ImageData): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

async function decode(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

function crop(image: ImageData, rect: typeof PHOTO): number[] {
  const out: number[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    out.push(...image.data.subarray((y * image.width + rect.x) * 4, (y * image.width + rect.x + rect.width) * 4));
  }
  return out;
}

async function save(bytes: Uint8Array, name: string, edit = IDENTITY_EDIT) {
  const { source } = await openSource(new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "image/png" }));
  const { name: savedName, blob } = await exportSource(source, edit);
  return { name: savedName, blob, image: await decode(blob) };
}

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function xmpChunk(xml: string): Uint8Array {
  const data = new TextEncoder().encode(`iTXtXML:com.adobe.xmp\0\0\0\0\0${xml}`);
  const chunk = new Uint8Array(data.length + 8);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length - 4);
  chunk.set(data, 4);
  view.setUint32(chunk.length - 4, crc32(data));
  return chunk;
}

function withChunk(png: Uint8Array, chunk: Uint8Array): Uint8Array {
  return new Uint8Array([...png.subarray(0, 33), ...chunk, ...png.subarray(33)]);
}

function xmpChunks(png: Uint8Array): number[][] {
  const found: number[][] = [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = 8; offset + 12 <= png.length; ) {
    const end = offset + 12 + view.getUint32(offset);
    const head = new TextDecoder().decode(png.subarray(offset + 4, offset + 26));
    if (head.startsWith("iTXtXML:com.adobe.xmp\0")) found.push([...png.subarray(offset, end)]);
    offset = end;
  }
  return found;
}

const XMP = xmpChunk('<x:xmpmeta xmlns:x="adobe:ns:meta/"><vrc:WorldID>wrld_test</vrc:WorldID></x:xmpmeta>');

describe("open and export", () => {
  it("crops a print to its photo, pixel for pixel", async () => {
    const original = print();
    const saved = await save(await encode(original), "VRChat_2026-10-18_02-14-01.png");
    expect(saved.name).toBe("VRChat_2026-10-18_02-14-01_crop.png");
    expect([saved.image.width, saved.image.height]).toEqual([1920, 1080]);
    expect(crop(saved.image, { x: 0, y: 0, width: 1920, height: 1080 })).toEqual(crop(original, PHOTO));
  });

  const STRIP_CORNERS = [
    [0, 0],
    [2047, 0],
    [0, PHOTO.y + PHOTO.height - 1],
    [2047, PHOTO.y + PHOTO.height - 1],
  ];

  it.each(STRIP_CORNERS)("keeps the whole image when the margin pixel (%i, %i) is not white", async (x, y) => {
    const original = print();
    original.data[(y * 2048 + x) * 4 + 1] = 254;
    const saved = await save(await encode(original), "near-print.png");
    expect(saved.name).toBe("near-print_edit.png");
    expect([saved.image.width, saved.image.height]).toEqual([2048, 1440]);
  });

  it("still crops a print whose photo bleeds one pixel into the margin", async () => {
    const original = print();
    for (let x = PHOTO.x; x < PHOTO.x + PHOTO.width; x += 7) original.data.set([128, 128, 128], ((PHOTO.y - 1) * 2048 + x) * 4);
    for (let y = PHOTO.y; y < PHOTO.y + PHOTO.height; y += 7) {
      original.data.set([128, 128, 128], (y * 2048 + PHOTO.x - 1) * 4);
      original.data.set([128, 128, 128], (y * 2048 + PHOTO.x + PHOTO.width) * 4);
    }
    const saved = await save(await encode(original), "bleed.png");
    expect(saved.name).toBe("bleed_crop.png");
    expect(crop(saved.image, { x: 0, y: 0, width: 1920, height: 1080 })).toEqual(crop(original, PHOTO));
  });

  it("still crops a print whose caption is black", async () => {
    const original = print();
    for (let y = PHOTO.y + PHOTO.height; y < 1440; y++) {
      for (let x = 0; x < 2048; x++) original.data.set([0, 0, 0], (y * 2048 + x) * 4);
    }
    const saved = await save(await encode(original), "dark.png");
    expect(saved.name).toBe("dark_crop.png");
    expect([saved.image.width, saved.image.height]).toEqual([1920, 1080]);
  });

  it.each([
    [1920, 1080],
    [1080, 1920],
  ])("saves a %ix%i photo unchanged", async (width, height) => {
    const original = pattern(width, height);
    const saved = await save(await encode(original), "photo.png");
    expect(saved.name).toBe("photo_edit.png");
    expect([saved.image.width, saved.image.height]).toEqual([width, height]);
    expect(crop(saved.image, { x: 0, y: 0, width, height })).toEqual(crop(original, { x: 0, y: 0, width, height }));
  });

  it("keeps the original XMP byte for byte", async () => {
    const saved = await save(withChunk(await encode(print()), XMP), "print.png");
    expect(xmpChunks(new Uint8Array(await saved.blob.arrayBuffer()))).toEqual([[...XMP]]);
  });

  it("writes no XMP when the input has none", async () => {
    const saved = await save(await encode(print()), "print.png");
    expect(xmpChunks(new Uint8Array(await saved.blob.arrayBuffer()))).toEqual([]);
  });

  it("saves a print rotated right as 1080x1920", async () => {
    const saved = await save(await encode(print()), "print.png", rotateRight(IDENTITY_EDIT));
    expect([saved.image.width, saved.image.height]).toEqual([1080, 1920]);
  });

  it.each([
    ["a.b.PNG", "print", "a.b_crop.png"],
    ["noext", "print", "noext_crop.png"],
    ["image.jpg", "photo", "image_edit.png"],
  ] as const)("names %s (%s) as %s", async (name, kind, expected) => {
    const image = kind === "print" ? print() : pattern(1920, 1080);
    expect((await save(await encode(image), name)).name).toBe(expected);
  });

  it("rejects a file that is not an image", async () => {
    await expect(openSource(new File(["hello"], "notes.txt", { type: "text/plain" }))).rejects.toThrow();
  });
});
