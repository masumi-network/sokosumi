import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { prepareSocialPostImage } from "./social-post-image";

async function image(
  width: number,
  height: number,
  format: "jpeg" | "png" = "jpeg",
) {
  return sharp({
    create: { width, height, channels: 3, background: "#d4d4d4" },
  })
    .toFormat(format)
    .toBuffer();
}

describe("prepareSocialPostImage", () => {
  it.each(["x", "linkedin", "facebook", "instagram"] as const)(
    "keeps an allowed wide JPEG byte-for-byte for %s",
    async (provider) => {
      const bytes = await image(1280, 720);
      const result = await prepareSocialPostImage(
        provider,
        bytes,
        "image/jpeg",
      );
      expect(result.bytes).toBe(bytes);
      expect(result.notice).toBeUndefined();
      expect(await sharp(result.bytes).metadata()).toMatchObject({
        width: 1280,
        height: 720,
      });
    },
  );

  it.each(["x", "linkedin", "facebook"] as const)(
    "keeps a tall PNG byte-for-byte for %s",
    async (provider) => {
      const bytes = await image(720, 1280, "png");
      const result = await prepareSocialPostImage(provider, bytes, "image/png");
      expect(result.bytes).toBe(bytes);
      expect(result.notice).toBeUndefined();
    },
  );

  it("pads a tall Instagram image to 4:5 without cutting off its edges", async () => {
    const bytes = await image(720, 1280);
    const result = await prepareSocialPostImage(
      "instagram",
      bytes,
      "image/jpeg",
    );
    expect(await sharp(result.bytes).metadata()).toMatchObject({
      width: 1024,
      height: 1280,
    });
    expect(result.notice).toBe("Instagram will pad this image to 4:5.");
    const { data, info } = await sharp(result.bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(245);
    expect(data[Math.floor(info.width / 2) * info.channels]).toBeGreaterThan(
      200,
    );
    expect(data[Math.floor(info.width / 2) * info.channels]).toBeLessThan(230);
  });

  it("pads an extra-wide Instagram image within 1.91:1", async () => {
    const result = await prepareSocialPostImage(
      "instagram",
      await image(1200, 300),
      "image/jpeg",
    );
    const metadata = await sharp(result.bytes).metadata();
    expect((metadata.width ?? 0) / (metadata.height ?? 1)).toBeLessThanOrEqual(
      1.91,
    );
    expect(result.notice).toBe("Instagram will pad this image to 1.91:1.");
  });

  it("converts PNG to JPEG only where Instagram requires it", async () => {
    const result = await prepareSocialPostImage(
      "instagram",
      await image(1280, 720, "png"),
      "image/png",
    );
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.notice).toBe("Instagram needs a JPEG copy.");
    expect(await sharp(result.bytes).metadata()).toMatchObject({
      width: 1280,
      height: 720,
    });
  });

  it("keeps oversized Instagram originals and reports the platform's unavoidable resize", async () => {
    const bytes = await image(2880, 1620);
    const result = await prepareSocialPostImage(
      "instagram",
      bytes,
      "image/jpeg",
    );
    expect(result.bytes).toBe(bytes);
    expect(await sharp(result.bytes).metadata()).toMatchObject({
      width: 2880,
      height: 1620,
    });
    expect(result.notice).toBe("Instagram will resize this image.");
    expect(result.code).toBe("resize");
  });

  it("keeps LinkedIn images strictly below its pixel limit without changing aspect", async () => {
    const result = await prepareSocialPostImage(
      "linkedin",
      await image(8000, 5000),
      "image/jpeg",
    );
    const { width = 0, height = 0 } = await sharp(result.bytes).metadata();
    expect(width * height).toBeLessThan(36_152_320);
    expect(width / height).toBeCloseTo(1.6, 3);
    expect(result.notice).toBe("LinkedIn will resize this image.");
    expect(result.code).toBe("resize");
  });
  it.each(["instagram", "x"] as const)(
    "reduces an image over %s's documented byte limit with a notice",
    async (provider) => {
      const original = await image(1280, 720);
      const bytes = Buffer.concat([original, Buffer.alloc(8_000_001)]);
      const prepared = await prepareSocialPostImage(
        provider,
        bytes,
        "image/jpeg",
      );
      expect(prepared.bytes.byteLength).toBeLessThan(
        provider === "x" ? 5_000_000 : 8_000_000,
      );
      expect(prepared.notice).toBe(
        `${provider === "x" ? "X" : "Instagram"} needs a smaller file.`,
      );
      expect(await sharp(prepared.bytes).metadata()).toMatchObject({
        width: 1280,
        height: 720,
      });
    },
  );
  it("keeps CMYK JPEG bytes and reports Instagram's own sRGB conversion", async () => {
    const bytes = await sharp(await image(1280, 720))
      .toColourspace("cmyk")
      .jpeg()
      .toBuffer();
    const result = await prepareSocialPostImage(
      "instagram",
      bytes,
      "image/jpeg",
    );
    expect(result.bytes).toBe(bytes);
    expect(result.code).toBe("srgb");
    expect(result.notice).toBe("Instagram will convert this image to sRGB.");
  });
});
