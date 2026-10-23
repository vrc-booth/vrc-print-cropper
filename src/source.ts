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
  // TODO:
  //   const xmp = findXmpChunk(new Uint8Array(await file.arrayBuffer()))
  //   const bitmap = await decode(file)
  //   try {
  //     const { kind, rect } = classify(readPixels(bitmap, fullRect(bitmap)))
  //     const source = { file, kind, rect, xmp }
  //     return { source, thumb: readPixels(bitmap, rect, THUMB_SIDE) }
  //   } finally { bitmap.close() }
  throw new Error("not implemented");
}

/** The photo region (crop already applied), scaled down so its long side <= maxSide. Never upscales. */
export async function readSource(source: Source, maxSide = Infinity): Promise<Pixels> {
  throw new Error("not implemented");
}

/**
 * Full-resolution render -> lossless PNG -> original XMP spliced back -> named per kind.
 * Same `render` as the preview; only the input size differs.
 */
export async function exportSource(source: Source, edit: Edit): Promise<{ name: string; blob: Blob }> {
  // TODO:
  //   const out = render(await readSource(source), edit)
  //   let bytes = await encodePng(out)
  //   if (source.xmp) bytes = withXmp(bytes, source.xmp)
  //   return { name: outputName(source.file.name, source.kind), blob: new Blob([bytes], { type: "image/png" }) }
  throw new Error("not implemented");
}

function decode(file: Blob): Promise<ImageBitmap> {
  // TODO: createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" })
  // "none" keeps opaque 8-bit pixels byte-exact through the canvas round trip.
  throw new Error("not implemented");
}

function readPixels(bitmap: ImageBitmap, rect: Rect, maxSide = Infinity): Pixels {
  // TODO: scale = min(1, maxSide / max(rect.width, rect.height)); canvas sized round(rect * scale);
  // ctx = getContext("2d", { willReadFrequently: true }); imageSmoothingQuality = "high";
  // drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, w, h); return getImageData(...)
  // At scale 1 this is an exact copy, so this is also the crop.
  throw new Error("not implemented");
}

function fullRect(bitmap: ImageBitmap): Rect {
  return { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
}

function encodePng(px: Pixels): Promise<Uint8Array> {
  // TODO: canvas.toBlob("image/png") -> arrayBuffer -> Uint8Array; reject on null blob
  throw new Error("not implemented");
}
