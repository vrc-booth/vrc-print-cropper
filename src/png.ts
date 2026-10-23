
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
  // TODO:
  //   if first 8 bytes !== SIGNATURE return null
  //   off = 8
  //   while off + 12 <= len:
  //     n = u32be(off); type = ascii(off+4, 4); end = off + 12 + n
  //     if end > len return null
  //     if type === "iTXt" and data (off+8 ..) starts with XMP_KEYWORD + "\0":
  //       return file.slice(off, end) as XmpChunk
  //     if type === "IEND" return null
  //     off = end
  //   return null
  throw new Error("not implemented");
}

/**
 * Inserts `xmp` directly after IHDR of a PNG we just encoded (canvas output, so trusted shape).
 * Any XMP chunk already present is dropped first, so withXmp(withXmp(p, x), x) === withXmp(p, x).
 * Throws if `png` does not start with signature + IHDR: that is a bug, not user input.
 */
export function withXmp(png: Uint8Array, xmp: XmpChunk): Uint8Array {
  // TODO:
  //   assert signature and bytes 12..16 === "IHDR" and u32be(8) === 13
  //   ihdrEnd = 8 + 12 + 13 = 33
  //   rest = png.subarray(33) with any existing XMP iTXt chunk removed (walk chunks as above)
  //   return concat(png.subarray(0, 33), xmp, rest)
  throw new Error("not implemented");
}
