import { describe, expect, it } from "vitest";

import {
  type AdEvalCheck,
  deltaE2000,
  evaluateAdHardChecks,
  extractDominantColors,
  normalizedTextSimilarity,
} from "./ad-eval-checks";

const INPUT = {
  width: 1080,
  height: 1080,
  aspectRatio: "1:1",
  dominantColors: [{ r: 255, g: 0, b: 0, weight: 1 }],
  brandColors: ["#ff0000"],
  expectedText: ["Made for everyday adventures"],
  prompt: "A launch ad",
  useProductCutout: false,
  observations: {
    text: ["Made for everyday adventures"],
    garbledText: false,
    safe: true,
    logoPresent: null,
  },
};

function check(
  id: AdEvalCheck["id"],
  input: Parameters<typeof evaluateAdHardChecks>[0] = INPUT,
) {
  return evaluateAdHardChecks(input).find((result) => result.id === id);
}

describe("evaluateAdHardChecks", () => {
  it("passes correctly shaped, large, on-palette ads with matching text", () => {
    expect(evaluateAdHardChecks(INPUT)).toEqual([
      { id: "aspect_ok", pass: true, value: 0 },
      { id: "size_ok", pass: true, value: 1080 },
      { id: "palette_adherence", pass: true, value: 0 },
      { id: "text_match", pass: true, value: 1 },
      { id: "garbled_text", pass: true, value: false },
      { id: "logo_present", pass: null, value: null },
      { id: "safety", pass: true, value: true },
    ]);
  });

  it.each([990, 1010])(
    "includes the ±1%% aspect boundary at width %i",
    (width) => {
      expect(check("aspect_ok", { ...INPUT, width, height: 1000 })?.pass).toBe(
        true,
      );
    },
  );

  it.each([989, 1011])(
    "fails beyond the aspect tolerance at width %i",
    (width) => {
      expect(check("aspect_ok", { ...INPUT, width, height: 1000 })?.pass).toBe(
        false,
      );
    },
  );

  it("compares the returned shape against the requested rectangular placement", () => {
    expect(
      check("aspect_ok", {
        ...INPUT,
        aspectRatio: "16:9",
        width: 1920,
        height: 1080,
      }),
    ).toEqual({ id: "aspect_ok", pass: true, value: 0 });
  });

  it.each(["1:1", "4:5", "9:16", "16:9"])(
    "requires a 1080px short side for %s",
    (aspectRatio) => {
      expect(check("size_ok", { ...INPUT, aspectRatio })?.pass).toBe(true);
      expect(
        check("size_ok", { ...INPUT, aspectRatio, width: 1079 })?.pass,
      ).toBe(false);
    },
  );

  it("marks unrecognized placement requirements and missing geometry as N/A", () => {
    expect(check("size_ok", { ...INPUT, aspectRatio: "3:2" })?.pass).toBeNull();
    expect(check("aspect_ok", { ...INPUT, width: null })?.pass).toBeNull();
    expect(
      check("aspect_ok", { ...INPUT, aspectRatio: "invalid" })?.pass,
    ).toBeNull();
    expect(check("size_ok", { ...INPUT, height: 0 })?.pass).toBe(false);
  });

  it("weights palette distance by image coverage and rejects off-brand colors", () => {
    const offBrand = { r: 0, g: 255, b: 0, weight: 1 };
    const red = INPUT.dominantColors[0];
    expect(
      check("palette_adherence", { ...INPUT, dominantColors: [offBrand] })
        ?.pass,
    ).toBe(false);
    expect(
      check("palette_adherence", {
        ...INPUT,
        dominantColors: [
          { ...red, weight: 0.95 },
          { ...offBrand, weight: 0.05 },
        ],
      })?.pass,
    ).toBe(true);
    expect(
      check("palette_adherence", { ...INPUT, brandColors: ["#f00"] })?.value,
    ).toBe(0);
  });

  it("skips palette comparison without usable Brand Kit colors or pixels", () => {
    expect(
      check("palette_adherence", { ...INPUT, brandColors: [] })?.pass,
    ).toBeNull();
    expect(
      check("palette_adherence", { ...INPUT, brandColors: ["invalid"] })?.pass,
    ).toBeNull();
    expect(
      check("palette_adherence", { ...INPUT, dominantColors: [] })?.pass,
    ).toBeNull();
  });

  it("converts decoded sRGB colors into Lab before measuring ΔE2000", () => {
    const result = check("palette_adherence", {
      ...INPUT,
      dominantColors: [{ r: 0, g: 0, b: 0, weight: 1 }],
      brandColors: ["#fff"],
    });
    expect(result?.value).toBeCloseTo(100, 4);
    expect(result?.pass).toBe(false);
  });

  it("matches an approved line split across OCR lines", () => {
    expect(
      check("text_match", {
        ...INPUT,
        expectedText: ["Another approved line", ...INPUT.expectedText],
        observations: {
          ...INPUT.observations,
          text: ["Made for", "everyday adventures"],
        },
      })?.pass,
    ).toBe(true);
  });

  it("accepts text similarity at 0.9 and rejects below it or absent text", () => {
    expect(
      check("text_match", {
        ...INPUT,
        expectedText: ["abcdefghij"],
        observations: { ...INPUT.observations, text: ["abcdefghix"] },
      }),
    ).toEqual({ id: "text_match", pass: true, value: 0.9 });
    expect(
      check("text_match", {
        ...INPUT,
        expectedText: ["abcdefghij"],
        observations: { ...INPUT.observations, text: ["abcdefghxx"] },
      })?.pass,
    ).toBe(false);
    expect(
      check("text_match", {
        ...INPUT,
        observations: { ...INPUT.observations, text: [] },
      })?.pass,
    ).toBe(false);
  });

  it.each([
    { useProductCutout: true },
    { prompt: "Product shot, no text" },
    { prompt: "Show the product without any text" },
    { prompt: "Text-free lifestyle ad" },
    { prompt: "Do not render any text" },
    {
      prompt:
        "Keep the upper area clear and leave marketing text out of the artwork.",
    },
    { expectedText: [] },
    { expectedText: [" "] },
  ])("skips text matching when inapplicable: %j", (override) => {
    expect(check("text_match", { ...INPUT, ...override })).toEqual({
      id: "text_match",
      pass: null,
      value: null,
    });
  });

  it("uses the single judge observations for garbled text, safety and requested logos", () => {
    const input = {
      ...INPUT,
      logoRequested: true,
      observations: {
        text: [],
        garbledText: true,
        safe: false,
        logoPresent: false,
      },
    };
    expect(check("garbled_text", input)?.pass).toBe(false);
    expect(check("safety", input)?.pass).toBe(false);
    expect(check("logo_present", input)?.pass).toBe(false);
    expect(
      check("logo_present", {
        ...input,
        observations: { ...input.observations, logoPresent: true },
      })?.pass,
    ).toBe(true);
    expect(check("safety", { ...INPUT, falNsfw: true })?.pass).toBe(false);
  });
});

describe("normalizedTextSimilarity", () => {
  it("normalizes case, punctuation, whitespace and Unicode compatibility characters", () => {
    expect(
      normalizedTextSimilarity(
        "  MADE for everyday adventures! ",
        "made for everyday\nADVENTURES",
      ),
    ).toBe(1);
    expect(normalizedTextSimilarity("ＡＣＭＥ Café", "acme Café")).toBe(1);
    expect(normalizedTextSimilarity("", "")).toBe(1);
    expect(normalizedTextSimilarity("Headline", "")).toBe(0);
  });
});

describe("extractDominantColors", () => {
  it("clusters colors deterministically with area and alpha weights", () => {
    const rgba = new Uint8Array([
      255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 128, 0, 255, 0, 0,
    ]);
    const colors = extractDominantColors(rgba);
    expect(colors).toHaveLength(2);
    expect(colors[0]).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(colors[0].weight).toBeCloseTo(2 / (2 + 128 / 255));
    expect(colors[1]).toMatchObject({ r: 0, g: 0, b: 255 });
    expect(extractDominantColors(rgba)).toEqual(colors);
  });

  it("reduces a gradient to at most five nonempty clusters", () => {
    const rgba = new Uint8Array(
      Array.from({ length: 64 }, (_, i) => [i * 4, i * 4, i * 4, 255]).flat(),
    );
    const colors = extractDominantColors(rgba);
    expect(colors).toHaveLength(5);
    expect(colors.reduce((sum, color) => sum + color.weight, 0)).toBeCloseTo(1);
    expect(colors.every((color) => color.weight > 0)).toBe(true);
  });

  it("returns no dominant colors for an empty or transparent image", () => {
    expect(extractDominantColors(new Uint8Array())).toEqual([]);
    expect(extractDominantColors(new Uint8Array([255, 0, 0, 0]))).toEqual([]);
  });
});

describe("deltaE2000", () => {
  // Sharma et al. supplemental data: https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt
  it.each([
    [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
    [50, -1.3802, -84.2814, 50, 0, -82.7485, 1],
    [50, 0, 0, 50, -1, 2, 2.3669],
    [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792],
    [50, 2.49, -0.001, 50, -2.49, 0.001, 7.1792],
    [50, 2.49, -0.001, 50, -2.49, 0.0011, 7.2195],
    [50, -0.001, 2.49, 50, 0.0009, -2.49, 4.8045],
    [50, -0.001, 2.49, 50, 0.001, -2.49, 4.8045],
    [50, -0.001, 2.49, 50, 0.0011, -2.49, 4.7461],
    [50, 2.5, 0, 50, 0, -2.5, 4.3065],
    [50, 2.5, 0, 73, 25, -18, 27.1492],
    [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  ])(
    "matches published Lab pair (%s, %s, %s) / (%s, %s, %s)",
    (l1, a1, b1, l2, a2, b2, expected) => {
      const left = { l: l1, a: a1, b: b1 };
      const right = { l: l2, a: a2, b: b2 };
      expect(deltaE2000(left, right)).toBeCloseTo(expected, 4);
      expect(deltaE2000(right, left)).toBeCloseTo(expected, 4);
    },
  );

  it("returns zero for identical colors", () => {
    const color = { l: 50, a: -10, b: 20 };
    expect(deltaE2000(color, color)).toBe(0);
  });
});
