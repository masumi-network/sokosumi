import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compositeStudioLogo } from "./brand-overlay";

describe("branding a Studio export", () => {
  it.each([
    ["top-left", 8, 6],
    ["top-right", 144, 6],
    ["bottom-left", 8, 106],
    ["bottom-right", 144, 106],
  ] as const)("uses the same logo pixels at %s", async (position, x, y) => {
    const image = await sharp({
      create: { width: 160, height: 120, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const logo = await sharp({
      create: { width: 12, height: 12, channels: 4, background: "#aa3311" },
    })
      .png()
      .toBuffer();

    const { data, info } = await sharp(
      await compositeStudioLogo(image, logo, position),
    )
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info).toMatchObject({ width: 160, height: 120, channels: 3 });
    const offset = (y * info.width + x) * info.channels;
    expect([...data.subarray(offset, offset + 3)]).toEqual([170, 51, 17]);
    const center = (60 * info.width + 80) * info.channels;
    expect([...data.subarray(center, center + 3)]).toEqual([255, 255, 255]);
  });
});
