declare const xmpChunk: unique symbol;
/**
 * A complete iTXt chunk whose keyword is "XML:com.adobe.xmp", exactly as it appeared in the
 * input file. Only `findXmpChunk` produces this brand, so `withXmp` cannot splice arbitrary bytes.
 */
export type XmpChunk = Uint8Array & { readonly [xmpChunk]: true };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const XMP_KEYWORD = "XML:com.adobe.xmp";

/**
 * Returns the input's XMP chunk, or null for non-PNG input, a PNG without XMP, or a truncated
 * or malformed file. Never throws: the bytes come straight from the user's disk.
 */
export function findXmpChunk(file: Uint8Array): XmpChunk | null {
  if (!hasSignature(file)) return null;
  for (const chunk of chunks(file, 8)) {
    if (chunk === null) return null;
    if (isXmp(file, chunk)) return file.slice(chunk.start, chunk.end) as XmpChunk;
    if (chunk.type === "IEND") return null;
  }
  return null;
}

/**
 * Inserts `xmp` directly after IHDR of a PNG we just encoded (canvas output, so trusted shape).
 * Any XMP chunk already present is dropped first, so withXmp(withXmp(p, x), x) === withXmp(p, x).
 * Throws if `png` does not start with signature + IHDR: that is a bug, not user input.
 */
export function withXmp(png: Uint8Array, xmp: XmpChunk): Uint8Array {
  if (!hasSignature(png) || png.length < IHDR_END || readU32(png, 8) !== 13 || ascii(png, 12, 4) !== "IHDR") {
    throw new Error("withXmp: not a PNG starting with IHDR");
  }
  const kept: Uint8Array[] = [png.subarray(0, IHDR_END), xmp];
  for (const chunk of chunks(png, IHDR_END)) {
    if (chunk === null) throw new Error("withXmp: truncated PNG");
    if (!isXmp(png, chunk)) kept.push(png.subarray(chunk.start, chunk.end));
  }
  const out = new Uint8Array(kept.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const IHDR_END = 8 + 12 + 13;

interface ChunkSpan {
  readonly start: number;
  readonly end: number;
  readonly type: string;
}

function* chunks(png: Uint8Array, offset: number): Generator<ChunkSpan | null> {
  while (offset + 12 <= png.length) {
    const end = offset + 12 + readU32(png, offset);
    if (end > png.length) {
      yield null;
      return;
    }
    yield { start: offset, end, type: ascii(png, offset + 4, 4) };
    offset = end;
  }
  if (offset !== png.length) yield null;
}

function isXmp(png: Uint8Array, chunk: ChunkSpan): boolean {
  return (
    chunk.type === "iTXt" &&
    chunk.end - chunk.start >= 12 + XMP_KEYWORD.length + 1 &&
    ascii(png, chunk.start + 8, XMP_KEYWORD.length) === XMP_KEYWORD &&
    png[chunk.start + 8 + XMP_KEYWORD.length] === 0
  );
}

function hasSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
