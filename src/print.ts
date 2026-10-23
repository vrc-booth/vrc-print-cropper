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
 */
export function classify(px: Pixels): { kind: SourceKind; rect: Rect } {
  // TODO:
  //   if (px.width !== PRINT_WIDTH || px.height !== PRINT_HEIGHT) return photo(full)
  //   for strip of MARGIN_STRIPS, for each pixel i: if (data[i] & data[i+1] & data[i+2]) !== 255 -> photo(full)
  //   return { kind: "print", rect: PRINT_PHOTO }
  throw new Error("not implemented");
}

/**
 * "<base>_crop.png" for prints, "<base>_edit.png" otherwise.
 * Base = name without its last extension: "a.b.png" -> "a.b", "noext" -> "noext", ".png" -> ".png".
 */
export function outputName(fileName: string, kind: SourceKind): string {
  throw new Error("not implemented");
}
