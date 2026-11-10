import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { renderStudioPng } from "./brand-overlay";

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
      await renderStudioPng(image, { logo: { bytes: logo, position } }),
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

  it("uses the displayed EXIF orientation when cropping a landscape placement", async () => {
    const source = await sharp({
      create: { width: 121, height: 161, channels: 3, background: "white" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const rendered = await renderStudioPng(source, { placement: "16:9" });
    await expect(sharp(rendered).metadata()).resolves.toMatchObject({
      width: 160,
      height: 90,
      format: "png",
    });
  });

  it("centers a vertical crop and positions the approved logo inside its new corners", async () => {
    const stripe = Buffer.from(
      '<svg width="20" height="120"><rect width="20" height="120" fill="blue"/></svg>',
    );
    const [source, logo] = await Promise.all([
      sharp({
        create: { width: 160, height: 120, channels: 3, background: "white" },
      })
        .composite([{ input: stripe, left: 0, top: 0 }])
        .png()
        .toBuffer(),
      sharp({
        create: { width: 12, height: 12, channels: 4, background: "#aa3311" },
      })
        .png()
        .toBuffer(),
    ]);
    const { data, info } = await sharp(
      await renderStudioPng(source, {
        placement: "9:16",
        logo: { bytes: logo, position: "bottom-right" },
      }),
    )
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 63, height: 112, channels: 3 });
    expect([...data.subarray(0, 3)]).toEqual([255, 255, 255]);
    const logoPixel = (100 * info.width + 53) * info.channels;
    expect([...data.subarray(logoPixel, logoPixel + 3)]).toEqual([170, 51, 17]);
  });
});
