import { describe, expect, it } from "vitest";

import { sniffImageMimeFromBytes } from "./image-mime.js";

describe("sniffImageMimeFromBytes", () => {
  it("detects PNG", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    expect(sniffImageMimeFromBytes(png)).toBe("image/png");
  });

  it("detects JPEG", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(sniffImageMimeFromBytes(jpeg)).toBe("image/jpeg");
  });

  it("detects GIF87a and GIF89a", () => {
    expect(
      sniffImageMimeFromBytes(
        new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00]),
      ),
    ).toBe("image/gif");
    expect(
      sniffImageMimeFromBytes(
        new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]),
      ),
    ).toBe("image/gif");
  });

  it("detects WebP (RIFF....WEBP)", () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffImageMimeFromBytes(webp)).toBe("image/webp");
  });

  it("returns null for empty, short, or non-image buffers", () => {
    expect(sniffImageMimeFromBytes(new Uint8Array())).toBeNull();
    expect(sniffImageMimeFromBytes(new Uint8Array([0x00, 0x01]))).toBeNull();
    expect(
      sniffImageMimeFromBytes(new TextEncoder().encode("%PDF-1.4")),
    ).toBeNull();
  });
});
