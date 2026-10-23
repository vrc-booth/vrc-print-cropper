import { render, type Edit, type Pixels, type Rect } from "./edit";
import { classify, outputName, type SourceKind } from "./print";
import { findXmpChunk, withXmp, type XmpChunk } from "./png";

export type { SourceKind };

/**
 * An opened file. Immutable. Full-resolution pixels are NOT kept: 40 decoded prints would be
 * ~470 MB, so pixels are re-decoded from `file` on demand (one preview, one export at a time).
 */
export interface Source {
  readonly file: File;
  readonly kind: SourceKind;
  /** Region of the decoded image that is the photo: the print's photo area, or the whole image. */
  readonly rect: Rect;
  readonly xmp: XmpChunk | null;
}

export const THUMB_SIDE = 240;
export const PREVIEW_SIDE = 1280;

/**
 * Reads bytes (for XMP), decodes once, classifies, and makes the thumbnail.
 * Rejects when the browser cannot decode the file; the caller shows that per file.
 */
export async function openSource(file: File): Promise<{ source: Source; thumb: Pixels }> {
  const xmp = findXmpChunk(new Uint8Array(await file.arrayBuffer()));
  const bitmap = await decode(file);
  try {
    const { kind, rect } = classify(bitmap.width, bitmap.height, () => readPixels(bitmap, fullRect(bitmap)));
    return { source: { file, kind, rect, xmp }, thumb: readPixels(bitmap, rect, THUMB_SIDE) };
  } finally {
    bitmap.close();
  }
}

/** The photo region (crop already applied), scaled down so its long side <= maxSide. Never upscales. */
export async function readSource(source: Source, maxSide = Infinity): Promise<Pixels> {
  const bitmap = await decode(source.file);
  try {
    return readPixels(bitmap, source.rect, maxSide);
  } finally {
    bitmap.close();
  }
}

/**
 * Full-resolution render -> lossless PNG -> original XMP spliced back -> named per kind.
 * Same `render` as the preview; only the input size differs.
 */
export async function exportSource(source: Source, edit: Edit): Promise<{ name: string; blob: Blob }> {
  const out = render(await readSource(source), edit);
  let bytes = await encodePng(out);
  if (source.xmp) bytes = withXmp(bytes, source.xmp);
  return { name: outputName(source.file.name, source.kind), blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }) };
}

function decode(file: Blob): Promise<ImageBitmap> {
  // "none" keeps opaque 8-bit pixels byte-exact through the canvas round trip.
  return createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function readPixels(bitmap: ImageBitmap, rect: Rect, maxSide = Infinity): Pixels {
  const scale = Math.min(1, maxSide / Math.max(rect.width, rect.height));
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  const context = context2d(new OffscreenCanvas(width, height), { willReadFrequently: true });
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function fullRect(bitmap: ImageBitmap): Rect {
  return { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
}

function encodePng(px: Pixels): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(px.width, px.height);
  const context = context2d(canvas);
  context.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
  return canvas.convertToBlob({ type: "image/png" }).then(async (blob) => new Uint8Array(await blob.arrayBuffer()));
}

function context2d(canvas: OffscreenCanvas, options?: CanvasRenderingContext2DSettings): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d", options);
  if (!context) throw new Error("2D canvas unavailable");
  return context;
}
