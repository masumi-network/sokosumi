import { describe, expect, it } from "vitest";

import {
  creditsPerImageCents,
  imageOutputDimensions,
  imageOutputMegapixels,
  isPerImageDerivableUnit,
} from "./image-credits.js";

const SQUARE_1K = { aspectRatio: "1:1", resolution: "1K" };

describe("imageOutputDimensions", () => {
  it("bounds the longest edge per tier and aligns to 32 pixels", () => {
    expect(imageOutputDimensions("16:9", "2K")).toEqual({
      width: 2048,
      height: 1152,
    });
    expect(imageOutputDimensions("4:5", "1K")).toEqual({
      width: 832,
      height: 1024,
    });
    expect(imageOutputDimensions("1:1", "0.5K")).toEqual({
      width: 512,
      height: 512,
    });
  });
});

describe("creditsPerImageCents", () => {
  it("charges the flat unit price for a per-image unit", () => {
    expect(
      creditsPerImageCents(
        { unit: "images", unitPriceUsd: 0.03 },
        { aspectRatio: "16:9", resolution: "2K" },
      ),
    ).toBe(3);
    expect(
      creditsPerImageCents(
        { unit: "generations", unitPriceUsd: 0.15 },
        SQUARE_1K,
      ),
    ).toBe(15);
  });

  it("scales an area-priced unit by the frame the studio asks for", () => {
    // 1024x1024 is 1.048576 megapixels, so $0.03/MP rounds up to 4 credits.
    expect(
      creditsPerImageCents(
        { unit: "megapixels", unitPriceUsd: 0.03 },
        SQUARE_1K,
      ),
    ).toBe(4);
    // 2048x2048 is four times that area, and so is four times the price.
    expect(
      creditsPerImageCents(
        { unit: "megapixels", unitPriceUsd: 0.03 },
        { aspectRatio: "1:1", resolution: "2K" },
      ),
    ).toBe(13);
    // A narrower frame is less area and therefore genuinely cheaper.
    expect(
      creditsPerImageCents(
        { unit: "processed megapixels", unitPriceUsd: 0.03 },
        { aspectRatio: "16:9", resolution: "1K" },
      ),
    ).toBe(2);
  });

  it("rounds up, so a fraction of a cent is never given away", () => {
    expect(
      creditsPerImageCents({ unit: "images", unitPriceUsd: 0.025 }, SQUARE_1K),
    ).toBe(3);
  });

  it("prefers a hand-verified per-tier figure over the unit price", () => {
    // fal lists Gemini Flash at $0.08 per image and then multiplies by 1.5 at
    // 2K. The unit alone cannot say that, so the verified table wins.
    const price = {
      unit: "images",
      unitPriceUsd: 0.08,
      perImageUsd: { "0.5K": 0.06, "1K": 0.08, "2K": 0.12 },
    };
    expect(
      creditsPerImageCents(price, { aspectRatio: "1:1", resolution: "2K" }),
    ).toBe(12);
    expect(
      creditsPerImageCents(price, { aspectRatio: "1:1", resolution: "0.5K" }),
    ).toBe(6);
  });

  it("falls back to the unit price for a tier the verified table skips", () => {
    expect(
      creditsPerImageCents(
        { unit: "images", unitPriceUsd: 0.04, perImageUsd: { "2K": 0.09 } },
        SQUARE_1K,
      ),
    ).toBe(4);
  });

  it("refuses to guess a per-image cost for a unit that has none", () => {
    for (const unit of ["compute seconds", "units", "credits"]) {
      expect(
        creditsPerImageCents({ unit, unitPriceUsd: 0.01 }, SQUARE_1K),
      ).toBe(null);
      expect(isPerImageDerivableUnit(unit)).toBe(false);
    }
    // An override may still supply the figure a human verified by hand.
    expect(
      creditsPerImageCents(
        {
          unit: "compute seconds",
          unitPriceUsd: 0.01,
          perImageUsd: { "1K": 0.05 },
        },
        SQUARE_1K,
      ),
    ).toBe(5);
  });

  it("treats an unusable unit price as not derivable", () => {
    expect(
      creditsPerImageCents(
        { unit: "megapixels", unitPriceUsd: Number.NaN },
        SQUARE_1K,
      ),
    ).toBe(null);
  });
});

describe("imageOutputMegapixels", () => {
  it("reports the area of the aligned frame", () => {
    expect(imageOutputMegapixels("1:1", "1K")).toBeCloseTo(1.048576, 6);
  });
});
