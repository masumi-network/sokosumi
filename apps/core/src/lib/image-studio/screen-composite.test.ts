import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { placeScreen, SCREEN_PANEL } from "./screen-composite";

const solid = (width: number, height: number, colour: string) =>
  sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer();

async function pixel(bytes: Buffer, x: number, y: number) {
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at], data[at + 1], data[at + 2]];
}

describe("placeScreen", () => {
  it("puts the real screenshot on the panel and leaves the rest of the picture alone", async () => {
    const picture = await solid(1000, 1250, "#ff0000");
    const placed = await placeScreen(
      picture,
      await solid(1440, 900, "#0000ff"),
    );
    expect(await sharp(placed).metadata()).toMatchObject({
      width: 1000,
      height: 1250,
    });
    // The panel's middle is the screenshot's own colour.
    expect(await pixel(placed, 500, Math.round(1250 * 0.58))).toEqual([
      0, 0, 255,
    ]);
    // The frame covers the whole panel: a browser window the model drew
    // there (it did once) never shows beside Core's.
    expect(await pixel(placed, 110, 940)).toEqual([243, 243, 243]);
    // Above the panel (the headline) and the logo corner stay as made.
    expect(await pixel(placed, 500, 100)).toEqual([255, 0, 0]);
    expect(await pixel(placed, 950, 1200)).toEqual([255, 0, 0]);
  });

  it("shows a phone capture's whole first screen, never the panel's cut of it", async () => {
    const picture = await solid(1080, 1350, "#ffffff");
    // A 1080-wide phone capture: its first screen is 2337 high; below is black.
    const page = await sharp({
      create: { width: 1080, height: 5000, channels: 3, background: "#00ff00" },
    })
      .composite([
        { input: await solid(1080, 2600, "#000000"), left: 0, top: 2400 },
      ])
      .png()
      .toBuffer();
    const placed = await placeScreen(picture, page);
    const top = Math.round(1350 * SCREEN_PANEL.top);
    const bottom = Math.round(1350 * SCREEN_PANEL.bottom);
    // The screen's lowest row is still the first screen (green), and it is
    // phone-shaped: narrower than the panel, the frame shows beside it.
    expect(await pixel(placed, 540, bottom - 4)).toEqual([0, 255, 0]);
    expect(await pixel(placed, 540, Math.round((top + bottom) / 2))).toEqual([
      0, 255, 0,
    ]);
    expect(await pixel(placed, 160, Math.round((top + bottom) / 2))).toEqual([
      243, 243, 243,
    ]);
  });
});
