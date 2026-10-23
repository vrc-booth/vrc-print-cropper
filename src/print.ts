import type { Pixels, Rect } from "./edit";

export type SourceKind = "print" | "photo";

const PRINT_WIDTH = 2048;
const PRINT_HEIGHT = 1440;
/** Measured on 37 real prints. */
const PRINT_PHOTO: Rect = { x: 64, y: 69, width: 1920, height: 1080 };

/** Derived from PRINT_PHOTO so detection and crop cannot disagree. The caption rows below the photo are excluded. */
const MARGIN_STRIPS: readonly Rect[] = [
  { x: 0, y: 0, width: PRINT_WIDTH, height: PRINT_PHOTO.y },
  { x: 0, y: PRINT_PHOTO.y, width: PRINT_PHOTO.x, height: PRINT_PHOTO.height },
  {
    x: PRINT_PHOTO.x + PRINT_PHOTO.width,
    y: PRINT_PHOTO.y,
    width: PRINT_WIDTH - PRINT_PHOTO.x - PRINT_PHOTO.width,
    height: PRINT_PHOTO.height,
  },
];

/**
 * Decides the kind and the photo region together, so the two can never disagree.
 * Print iff the size is exactly 2048x1440 and every pixel of MARGIN_STRIPS has R=G=B=255.
 * Anything else is a photo whose region is the full image.
 * `readPixels` is called only for images of print size, so large photos are never read whole.
 */
export function classify(width: number, height: number, readPixels: () => Pixels): { kind: SourceKind; rect: Rect } {
  const full = { kind: "photo", rect: { x: 0, y: 0, width, height } } as const;
  if (width !== PRINT_WIDTH || height !== PRINT_HEIGHT) return full;
  const px = readPixels();
  for (const strip of MARGIN_STRIPS) {
    for (let y = strip.y; y < strip.y + strip.height; y++) {
      for (let x = strip.x; x < strip.x + strip.width; x++) {
        const i = (y * px.width + x) * 4;
        if ((px.data[i] & px.data[i + 1] & px.data[i + 2]) !== 255) return full;
      }
    }
  }
  return { kind: "print", rect: PRINT_PHOTO };
}

/**
 * "<base>_crop.png" for prints, "<base>_edit.png" otherwise.
 * Base = name without its last extension: "a.b.png" -> "a.b", "noext" -> "noext", ".png" -> ".png".
 */
export function outputName(fileName: string, kind: SourceKind): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${base}${kind === "print" ? "_crop" : "_edit"}.png`;
}
