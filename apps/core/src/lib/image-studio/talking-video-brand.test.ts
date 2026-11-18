import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  fitEndCardLogo,
  fitSitePage,
  siteAddress,
} from "./talking-video-brand";

function picture(
  width: number,
  height: number,
  colour: { r: number; g: number; b: number; alpha?: number },
) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { alpha: 1, ...colour },
    },
  })
    .png()
    .toBuffer();
}

describe("fitSitePage", () => {
  it("makes a tall capture 1080 wide and keeps its height", async () => {
    const page = await fitSitePage(
      await picture(360, 1500, { r: 20, g: 20, b: 20 }),
    );

    const { width, height, format } = await sharp(page).metadata();
    expect({ width, height, format }).toEqual({
      width: 1080,
      height: 4500,
      format: "jpeg",
    });
  });

  it("stands a short page on its own colour, so the frame is filled", async () => {
    const page = await fitSitePage(
      await picture(360, 400, { r: 250, g: 250, b: 250 }),
    );

    const { width, height } = await sharp(page).metadata();
    expect({ width, height }).toEqual({ width: 1080, height: 1920 });
    const { data } = await sharp(page)
      .extract({ left: 500, top: 1900, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
  });
});

describe("fitEndCardLogo", () => {
  it("fits the logo into the card's box and asks for a dark card for a light logo", async () => {
    const fitted = await fitEndCardLogo(
      await picture(1200, 300, { r: 255, g: 255, b: 255 }),
    );

    const { width, height, format } = await sharp(fitted.logo).metadata();
    expect({ width, height, format }).toEqual({
      width: 640,
      height: 160,
      format: "png",
    });
    expect(fitted.dark).toBe(true);
  });

  it("asks for a light card for a dark logo", async () => {
    const fitted = await fitEndCardLogo(
      await picture(200, 200, { r: 16, g: 16, b: 16 }),
    );

    expect(fitted.dark).toBe(false);
  });
});

describe("siteAddress", () => {
  it("reads the address as people say it", () => {
    expect(siteAddress("https://www.cal.com/")).toBe("cal.com");
    expect(siteAddress("https://shop.example.com/de")).toBe(
      "shop.example.com/de",
    );
  });

  it("is null without a usable address", () => {
    expect(siteAddress(null)).toBeNull();
    expect(siteAddress("not a url")).toBeNull();
  });
});
