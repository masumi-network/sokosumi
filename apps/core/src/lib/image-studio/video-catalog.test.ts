import { creditsPerVideoCents } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  applyVideoCatalogOverrides,
  excludeUnpriceableVideoModels,
  getVideoCatalog,
  videoModel,
} from "./video-catalog";
import {
  DEFAULT_ANIMATE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  defaultVideoSettings,
  isUnchargeableVideoModel,
  type VideoModel,
} from "./video-model";

describe("resolved video catalog", () => {
  it("offers the hand-verified models from the committed snapshot, defaults first", () => {
    const catalog = getVideoCatalog();
    expect(catalog.defaultModelId).toBe(DEFAULT_VIDEO_MODEL_ID);
    expect(catalog.defaultAnimateModelId).toBe(DEFAULT_ANIMATE_MODEL_ID);
    expect(catalog.models.map((model) => model.id)).toEqual([
      "h3-max-turbo",
      "h3-max",
      "kling-v4",
      "h3-max-turbo-animate",
      "h3-max-animate",
      "kling-v4-animate",
    ]);
    expect(catalog.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("prices every offered resolution and length from a verified figure", () => {
    for (const model of getVideoCatalog().models) {
      expect(isUnchargeableVideoModel(model)).toBe(false);
      for (const resolution of model.resolutions)
        for (const durationSeconds of model.durations)
          expect(
            creditsPerVideoCents(model.price, { resolution, durationSeconds }),
          ).toBeGreaterThan(0);
    }
  });

  it("defaults to a 5 second 9:16 768P clip, the default resolution fal bills", () => {
    const model = videoModel(undefined, "text");
    expect(defaultVideoSettings(model)).toEqual({
      aspectRatio: "9:16",
      durationSeconds: 5,
      resolution: "768P",
    });
    expect(
      creditsPerVideoCents(model.price, {
        resolution: "768P",
        durationSeconds: 5,
      }),
    ).toBe(20);
  });

  it("never offers 1080P, which nobody verified a price for", () => {
    for (const model of getVideoCatalog().models) {
      expect(model.resolutions).not.toContain("1080P");
      expect(model.resolutions).not.toContain("1080p");
    }
  });

  it("refuses an id the catalog does not list", () => {
    expect(() => videoModel("no-such-model")).toThrow(
      /Unsupported video model/,
    );
  });
});

describe("video overrides", () => {
  const fetched: VideoModel = {
    id: "minimax-h3-max-text-to-video",
    label: "MiniMax H3 Max Text to Video",
    description: "",
    endpoint: "minimax/h3-max/text-to-video",
    input: "text",
    imageField: null,
    aspectRatios: ["9:16"],
    durations: [5],
    durationEncoding: "number",
    resolutions: ["480P", "768P"],
    fixedInput: {},
    curatedRank: null,
    notes: "",
    price: {
      unit: "seconds",
      unitPriceUsd: 0.0325,
      basis: "",
      sourceUrl: "",
      verifiedAt: "2026-10-25",
    },
    sourceUrls: [],
    verifiedAt: "2026-10-25",
  };

  it("holds out a fetched row nobody verified a price for", () => {
    const unknown = { ...fetched, endpoint: "someone/else/text-to-video" };
    const { models, exclusions } = excludeUnpriceableVideoModels(
      applyVideoCatalogOverrides([unknown]),
    );
    expect(models).toEqual([]);
    expect(exclusions[0]?.endpointId).toBe("someone/else/text-to-video");
  });

  it("keeps only resolutions the endpoint itself accepts", () => {
    const [model] = applyVideoCatalogOverrides([
      { ...fetched, resolutions: ["480P"] },
    ]);
    expect(model?.id).toBe("h3-max");
    expect(model?.resolutions).toEqual(["480P"]);
  });
});
