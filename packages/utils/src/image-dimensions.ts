import { sniffImageMimeFromBytes } from "./image-mime.js";

/**
 * Pixel dimensions read out of an image's own header.
 *
 * The last resort, for when whoever handed us the bytes did not say how big they
 * are. The image studio needs it because fal reports `width`/`height` for some
 * endpoints and not others: `fal-ai/recraft/v3/text-to-image` returns WebP with no
 * dimensions and `fal-ai/luma-photon` returns none either, so both stored 0x0 and
 * the lightbox printed "Size 0x0" — on a curated model, for anyone who pressed
 * Generate on arrival.
 *
 * Header only. Nothing here decodes pixels, allocates per pixel, or trusts a
 * length field far enough to walk off the end of the buffer: these bytes come from
 * a provider, and a malformed or hostile header must return null rather than throw
 * or spin. The format is identified by {@link sniffImageMimeFromBytes} so there is
 * one place that knows what a PNG looks like.
 */

export interface ImagePixelSize {
  width: number;
  height: number;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A size is only useful if it is a plausible positive integer. */
function valid(size: ImagePixelSize): ImagePixelSize | null {
  const { width, height } = size;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  // Nothing real is this big, and a bogus header should not become a stored fact.
  if (width > 100_000 || height > 100_000) return null;
  return size;
}

/** IHDR is always the first chunk, so the offsets are fixed. */
function readPng(bytes: Uint8Array): ImagePixelSize | null {
  if (bytes.byteLength < 24) return null;
  const data = view(bytes);
  return valid({ width: data.getUint32(16), height: data.getUint32(20) });
}

function readGif(bytes: Uint8Array): ImagePixelSize | null {
  if (bytes.byteLength < 10) return null;
  const data = view(bytes);
  return valid({
    width: data.getUint16(6, true),
    height: data.getUint16(8, true),
  });
}

/**
 * WebP, whose three flavours each carry the size somewhere else.
 *
 * `VP8 ` is lossy, `VP8L` lossless, `VP8X` the extended container that an animated
 * or alpha-carrying file uses. A file can be any of them, so all three are read.
 */
function readWebp(bytes: Uint8Array): ImagePixelSize | null {
  // Enough to name the chunk. Each flavour then checks its own length, because
  // they need different amounts: a lossless header is shorter than a lossy one.
  if (bytes.byteLength < 16) return null;
  const data = view(bytes);
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));

  if (chunk === "VP8 ") {
    // 3-byte frame tag, then the 3-byte sync code, then 14-bit dimensions.
    if (bytes.byteLength < 30) return null;
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    return valid({
      width: data.getUint16(26, true) & 0x3fff,
      height: data.getUint16(28, true) & 0x3fff,
    });
  }

  if (chunk === "VP8L") {
    // One signature byte, then 14 bits of width-1 and 14 bits of height-1 packed
    // little-endian across the next four.
    if (bytes.byteLength < 25 || bytes[20] !== 0x2f) return null;
    const packed = data.getUint32(21, true);
    return valid({
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    });
  }

  if (chunk === "VP8X") {
    if (bytes.byteLength < 30) return null;
    const canvasWidth =
      (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    const canvasHeight =
      (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
    return valid({ width: canvasWidth, height: canvasHeight });
  }

  return null;
}

/** Markers that carry no length, so the walk steps over them by two bytes. */
const JPEG_STANDALONE = new Set([
  0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9,
]);

/** The start-of-frame markers, which are the ones holding the dimensions. */
function isJpegStartOfFrame(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) return false;
  // DHT, JPG and DAC sit in the same range and are not frame headers.
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * JPEG, which means walking the segment chain to the first frame header.
 *
 * Bounded by the buffer at every step, so a truncated file or a segment claiming
 * an absurd length ends the walk instead of running off the end.
 */
function readJpeg(bytes: Uint8Array): ImagePixelSize | null {
  const data = view(bytes);
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      // Padding before a marker is legal; anything else means we are lost.
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (JPEG_STANDALONE.has(marker)) {
      offset += 2;
      continue;
    }
    const length = data.getUint16(offset + 2);
    if (length < 2) return null;
    if (isJpegStartOfFrame(marker)) {
      // length(2) precision(1) height(2) width(2)
      if (offset + 9 > bytes.byteLength) return null;
      return valid({
        height: data.getUint16(offset + 5),
        width: data.getUint16(offset + 7),
      });
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Read an image's pixel size from its header, or null.
 *
 * Null for a format this does not know, a truncated buffer, or a header whose
 * numbers are not plausible. A caller stores 0 and falls back to the rendered
 * image's intrinsic size.
 */
export function readImageDimensionsFromBytes(
  bytes: Uint8Array,
): ImagePixelSize | null {
  try {
    switch (sniffImageMimeFromBytes(bytes)) {
      case "image/png":
        return readPng(bytes);
      case "image/jpeg":
        return readJpeg(bytes);
      case "image/gif":
        return readGif(bytes);
      case "image/webp":
        return readWebp(bytes);
      default:
        return null;
    }
  } catch {
    // Provider bytes. A malformed header is a missing dimension, not an incident.
    return null;
  }
}
