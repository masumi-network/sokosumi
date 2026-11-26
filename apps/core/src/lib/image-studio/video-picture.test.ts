import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { fitVideoPicture, keepVideoPicture } from "./talking-video";

/** A portrait picture: a red top half over a blue bottom half. */
async function portrait(): Promise<Uint8Array> {
  return await sharp({
    create: { width: 900, height: 1600, channels: 3, background: "#0000ff" },
  })
    .composite([
      {
        input: {
          create: {
            width: 900,
            height: 800,
            channels: 3,
            background: "#ff0000",
          },
        },
        top: 0,
        left: 0,
      },
    ])
    .jpeg()
    .toBuffer();
}

async function pixel(bytes: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return {
    r: data[at]!,
    b: data[at + 2]!,
    width: info.width,
    height: info.height,
  };
}

describe("fitVideoPicture", () => {
  it("fills each shape's frame", async () => {
    const source = await portrait();
    for (const [shape, width, height] of [
      ["9:16", 1080, 1920],
      ["4:5", 1080, 1350],
      ["1:1", 1080, 1080],
      ["16:9", 1920, 1080],
    ] as const) {
      const { width: w, height: h } = await sharp(
        await fitVideoPicture(source, shape),
      ).metadata();
      expect([w, h]).toEqual([width, height]);
    }
  });

  it("shows a portrait whole in a widescreen frame instead of cutting its top off", async () => {
    const fitted = await fitVideoPicture(await portrait(), "16:9");
    // The picture's red top is still in the frame's top row, in the middle.
    const top = await pixel(fitted, 960, 4);
    expect(top.r).toBeGreaterThan(200);
    expect(top.b).toBeLessThan(60);
    const bottom = await pixel(fitted, 960, 1075);
    expect(bottom.b).toBeGreaterThan(200);
  });

  it("keeps a picture's own shape when it is stored", async () => {
    const kept = await sharp(
      await keepVideoPicture(await portrait()),
    ).metadata();
    expect([kept.width, kept.height]).toEqual([900, 1600]);
  });
});
