import { describe, expect, it } from "vitest";

import {
  buildFalVideoInput,
  creditsPerVideo,
  type VideoModel,
  validateVideoSettings,
} from "./video-model";

const TEXT: VideoModel = {
  id: "t",
  label: "Text model",
  description: "",
  endpoint: "owner/app/text-to-video",
  input: "text",
  imageField: null,
  aspectRatios: ["9:16", "16:9"],
  durations: [5, 10],
  durationEncoding: "string",
  resolutions: ["720p"],
  fixedInput: { mode: "std" },
  curatedRank: null,
  notes: "",
  price: {
    unit: "seconds",
    unitPriceUsd: 0.1,
    perSecondUsd: { "720p": 0.1 },
    basis: "",
    sourceUrl: "",
    verifiedAt: "2026-10-25",
  },
  sourceUrls: [],
  verifiedAt: "2026-10-25",
};

const IMAGE: VideoModel = {
  ...TEXT,
  id: "i",
  label: "Image model",
  input: "image",
  imageField: "start_image_url",
  aspectRatios: [],
};

const SETTINGS = {
  aspectRatio: "9:16",
  durationSeconds: 5,
  resolution: "720p",
};

describe("validateVideoSettings", () => {
  it("accepts what the model offers", () => {
    expect(validateVideoSettings(TEXT, SETTINGS, false)).toEqual(SETTINGS);
  });

  it("refuses a length, frame or resolution the model does not offer", () => {
    expect(() =>
      validateVideoSettings(TEXT, { ...SETTINGS, durationSeconds: 15 }, false),
    ).toThrow(/length/);
    expect(() =>
      validateVideoSettings(TEXT, { ...SETTINGS, aspectRatio: "1:1" }, false),
    ).toThrow(/aspect ratio/);
    expect(() =>
      validateVideoSettings(TEXT, { ...SETTINGS, resolution: "1080p" }, false),
    ).toThrow(/resolution/);
  });

  it("matches the input: a still for an image model, none for a text model", () => {
    expect(() => validateVideoSettings(IMAGE, SETTINGS, false)).toThrow(
      /animates an image/,
    );
    expect(() => validateVideoSettings(TEXT, SETTINGS, true)).toThrow(
      /from text/,
    );
  });

  it("does not hold an image model to a frame: it follows its still", () => {
    expect(() =>
      validateVideoSettings(IMAGE, { ...SETTINGS, aspectRatio: "1:1" }, true),
    ).not.toThrow();
  });
});

describe("creditsPerVideo", () => {
  it("charges the verified figure per second, rounded up", () => {
    expect(creditsPerVideo(TEXT, SETTINGS)).toBe(50);
  });

  it("throws rather than charging nothing for an unverified resolution", () => {
    expect(() =>
      creditsPerVideo(TEXT, { ...SETTINGS, resolution: "1080p" }),
    ).toThrow(/no verified price/);
  });
});

describe("buildFalVideoInput", () => {
  it("writes the length the way the schema wants it and keeps fixed fields", () => {
    expect(
      buildFalVideoInput(TEXT, {
        prompt: "a fox",
        settings: SETTINGS,
        imageUrl: null,
      }),
    ).toEqual({
      mode: "std",
      prompt: "a fox",
      duration: "5",
      resolution: "720p",
      aspect_ratio: "9:16",
    });
  });

  it("puts the still in the model's field and sends no frame", () => {
    const body = buildFalVideoInput(IMAGE, {
      prompt: "a fox",
      settings: SETTINGS,
      imageUrl: "https://v3b.fal.media/files/a.png",
    });
    expect(body.start_image_url).toBe("https://v3b.fal.media/files/a.png");
    expect(body).not.toHaveProperty("aspect_ratio");
  });
});
