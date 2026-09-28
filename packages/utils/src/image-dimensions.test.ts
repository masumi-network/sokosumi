import { describe, expect, it } from "vitest";

import { readImageDimensionsFromBytes } from "./image-dimensions.js";

/**
 * Headers are built by hand here rather than checked in as fixtures, so the test
 * says what each format actually puts where. The sizes are the ones the image
 * studio measured on preview: 1024x1024 for the PNG case, 1024x1024 WebP from
 * `fal-ai/recraft/v3/text-to-image`, which stored 0x0 before this existed.
 */

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const data = new DataView(bytes.buffer);
  data.setUint32(16, width);
  data.setUint32(20, height);
  return bytes;
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const data = new DataView(bytes.buffer);
  data.setUint16(6, width, true);
  data.setUint16(8, height, true);
  return bytes;
}

function riff(chunk: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + 8 + payload.byteLength);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  for (let index = 0; index < 4; index += 1) {
    bytes[12 + index] = chunk.charCodeAt(index);
  }
  bytes.set(payload, 20);
  return bytes;
}

/** Lossy: 3-byte frame tag, 0x9D 0x01 0x2A sync code, then 14-bit dimensions. */
function webpLossy(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(10);
  payload.set([0, 0, 0, 0x9d, 0x01, 0x2a], 0);
  const data = new DataView(payload.buffer);
  data.setUint16(6, width, true);
  data.setUint16(8, height, true);
  return riff("VP8 ", payload);
}

/** Lossless: signature byte, then width-1 and height-1 packed into 28 bits. */
function webpLossless(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(6);
  payload[0] = 0x2f;
  const packed = (width - 1) | ((height - 1) << 14);
  new DataView(payload.buffer).setUint32(1, packed, true);
  return riff("VP8L", payload);
}

/** Extended: 4 reserved/flag bytes, then 24-bit canvas width-1 and height-1. */
function webpExtended(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(10);
  const w = width - 1;
  const h = height - 1;
  payload.set([0, 0, 0, 0], 0);
  payload.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 4);
  payload.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 7);
  return riff("VP8X", payload);
}

/** SOI, an APP0 segment to be walked over, then a baseline SOF0. */
function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof0 = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

describe("readImageDimensionsFromBytes", () => {
  it("reads a PNG", () => {
    expect(readImageDimensionsFromBytes(png(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("reads a JPEG by walking to the first frame header", () => {
    expect(readImageDimensionsFromBytes(jpeg(1344, 768))).toEqual({
      width: 1344,
      height: 768,
    });
  });

  it("reads all three WebP flavours", () => {
    // The format `fal-ai/recraft/v3/text-to-image` returns, which stored 0x0.
    expect(readImageDimensionsFromBytes(webpLossy(1024, 1024))).toEqual({
      width: 1024,
      height: 1024,
    });
    expect(readImageDimensionsFromBytes(webpLossless(832, 1216))).toEqual({
      width: 832,
      height: 1216,
    });
    expect(readImageDimensionsFromBytes(webpExtended(2048, 1152))).toEqual({
      width: 2048,
      height: 1152,
    });
  });

  it("reads a GIF", () => {
    expect(readImageDimensionsFromBytes(gif(320, 240))).toEqual({
      width: 320,
      height: 240,
    });
  });

  it("answers null for anything it does not recognise", () => {
    expect(readImageDimensionsFromBytes(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readImageDimensionsFromBytes(new Uint8Array(0))).toBeNull();
    // A PDF, say: sniffed as nothing, so no parser runs.
    expect(
      readImageDimensionsFromBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    ).toBeNull();
  });

  it("answers null rather than throwing on a truncated header", () => {
    for (const source of [
      png(10, 10),
      jpeg(10, 10),
      webpLossy(10, 10),
      webpLossless(10, 10),
      webpExtended(10, 10),
      gif(10, 10),
    ]) {
      // Every prefix of a real header. Provider bytes can arrive cut short, and
      // none of these may throw or run off the end of the buffer.
      for (let length = 0; length < source.byteLength; length += 1) {
        expect(() =>
          readImageDimensionsFromBytes(source.subarray(0, length)),
        ).not.toThrow();
      }
    }
  });

  it("rejects a header whose numbers are not plausible", () => {
    // Zero is what a malformed header usually gives, and storing it is how
    // "Size 0x0" reached the screen in the first place.
    expect(readImageDimensionsFromBytes(png(0, 0))).toBeNull();
    expect(readImageDimensionsFromBytes(png(1024, 0))).toBeNull();
    expect(readImageDimensionsFromBytes(png(4_000_000_000, 10))).toBeNull();
  });

  it("does not read a JPEG segment length it cannot trust", () => {
    // APP0 claiming a length that runs past the buffer: the walk ends, no throw.
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x00, 0x00,
    ]);
    expect(readImageDimensionsFromBytes(bytes)).toBeNull();
  });
});
