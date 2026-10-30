import { randomBytes } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { fitDisplayImage } from "@/lib/ads/display-image-fit";

const image = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: "#336699" },
  });
const png = (width: number, height: number) =>
  image(width, height).png().toBuffer();

describe("fitDisplayImage", () => {
  it("centre-crops a 16:9 image to 1.91:1 for LANDSCAPE", async () => {
    const result = await fitDisplayImage(
      await png(1920, 1080),
      "image/png",
      "LANDSCAPE",
    );
    expect(result).toMatchObject({
      kind: "cropped",
      width: 1920,
      height: 1005,
    });
    if (result.kind !== "cropped") return;
    const meta = await sharp(result.bytes).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 1920, height: 1005 });
  });

  it("leaves a square image that is already 1:1 alone", async () => {
    await expect(
      fitDisplayImage(await png(1200, 1200), "image/png", "SQUARE"),
    ).resolves.toEqual({ kind: "unchanged", mimeType: "image/png" });
  });

  it("leaves a 1.91:1 image alone for LANDSCAPE", async () => {
    await expect(
      fitDisplayImage(await png(1910, 1000), "image/png", "LANDSCAPE"),
    ).resolves.toEqual({ kind: "unchanged", mimeType: "image/png" });
  });

  it("crops 4:3 to a centred square for SQUARE", async () => {
    const result = await fitDisplayImage(
      await png(1600, 1200),
      "image/png",
      "SQUARE",
    );
    expect(result).toMatchObject({
      kind: "cropped",
      width: 1200,
      height: 1200,
    });
  });

  it("converts a WebP that already fits, since Google does not take WebP", async () => {
    const webp = await image(1200, 1200).webp().toBuffer();
    const result = await fitDisplayImage(webp, "image/webp", "SQUARE");
    expect(result).toMatchObject({
      kind: "cropped",
      width: 1200,
      height: 1200,
    });
    if (result.kind !== "cropped") return;
    expect((await sharp(result.bytes).metadata()).format).toBe("jpeg");
  });

  it("refuses a LOGO smaller than 128x128", async () => {
    await expect(
      fitDisplayImage(await png(100, 100), "image/png", "LOGO"),
    ).resolves.toEqual({
      kind: "refused",
      reason: expect.stringContaining("at least 128x128"),
    });
  });

  it("crops a rotated phone photo as it is displayed, not as stored", async () => {
    // Stored 1600x1200 with EXIF orientation 6: displayed as 1200x1600 portrait.
    const rotated = await image(1600, 1200)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await fitDisplayImage(rotated, "image/jpeg", "LANDSCAPE");
    expect(result).toMatchObject({
      kind: "cropped",
      width: 1200,
      height: 628,
    });
  });

  it("rewrites a fitting image whose EXIF orientation would rotate it", async () => {
    const rotated = await image(1200, 1200)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await fitDisplayImage(rotated, "image/jpeg", "SQUARE");
    expect(result).toMatchObject({ kind: "cropped" });
    if (result.kind !== "cropped") return;
    expect((await sharp(result.bytes).metadata()).orientation).toBeUndefined();
  });

  it("refuses a truncated image whose header still reads", async () => {
    const whole = await image(1600, 1200).jpeg().toBuffer();
    await expect(
      fitDisplayImage(whole.subarray(0, 400), "image/jpeg", "SQUARE"),
    ).resolves.toEqual({
      kind: "refused",
      reason: "it is not a readable image",
    });
  });

  it("refuses a file that is not a readable image", async () => {
    await expect(
      fitDisplayImage(
        new TextEncoder().encode("not a png"),
        "image/png",
        "SQUARE",
      ),
    ).resolves.toEqual({
      kind: "refused",
      reason: "it is not a readable image",
    });
  });

  it("refuses a crop larger than Google's size limit", async () => {
    const noise = await sharp(randomBytes(4000 * 3000 * 3), {
      raw: { width: 4000, height: 3000, channels: 3 },
    })
      .png()
      .toBuffer();
    const result = await fitDisplayImage(noise, "image/png", "LANDSCAPE");
    expect(result).toEqual({
      kind: "refused",
      reason: expect.stringContaining("5120 KB"),
    });
  });
});
