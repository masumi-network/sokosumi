import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

/** A Chrome on this machine: GitHub's Ubuntu runners have one. */
const { CHROME } = vi.hoisted(() => {
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  return {
    CHROME: [
      process.env.CHROMIUM_EXECUTABLE_PATH,
      "/usr/bin/google-chrome",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ].find((candidate) => candidate && existsSync(candidate)),
  };
});
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), CHROMIUM_EXECUTABLE_PATH: CHROME }),
  };
});

vi.mock("@/lib/ffmpeg", async () => {
  const { cardFontDir } = await import("@/test/card-font");
  return {
    CAPTION_FONT_FAMILY: "Montserrat Black",
    captionFontsDir: cardFontDir,
  };
});

import { renderVideoCards, type VideoCard } from "./video-cards";
import { VIDEO_LAYOUTS } from "./video-layout";

/** Whether any pixel of the PNG outside the safe area is drawn. */
async function drawnOutsideSafe(
  png: Uint8Array,
  safe: { left: number; right: number; top: number; bottom: number },
): Promise<{ outside: number; inside: number }> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let outside = 0;
  let inside = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3]! === 0) continue;
      const within =
        x >= safe.left && x < safe.right && y >= safe.top && y < safe.bottom;
      if (within) inside += 1;
      else outside += 1;
    }
  }
  return { outside, inside };
}

describe.runIf(Boolean(CHROME))("video cards drawn by Chromium", () => {
  const LONG: VideoCard[] = [
    {
      kind: "offer",
      text: "Twenty percent off every bag of freshly roasted single origin beans when you order before the end of this coming Friday evening",
      detail:
        "Delivered within two working days to anywhere in the country, with a handwritten note from the roaster who picked your beans",
    },
    {
      kind: "title",
      text: "Supercalifragilisticexpialidociousroastingmethodologyexplained",
    },
  ];

  for (const shape of ["9:16", "4:5", "1:1", "16:9"] as const) {
    it(`keeps a long card's words whole inside the safe area (${shape})`, async () => {
      const { safe } = VIDEO_LAYOUTS[shape];
      const pngs = await renderVideoCards(
        LONG,
        { colors: ["#6400FF"], font: null },
        shape,
      );
      expect(pngs).toHaveLength(LONG.length);
      for (const png of pngs!) {
        const drawn = await drawnOutsideSafe(png, safe);
        expect(drawn.outside).toBe(0);
        expect(drawn.inside).toBeGreaterThan(0);
      }
    }, 60_000);
  }
});
