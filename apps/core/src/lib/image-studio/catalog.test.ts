import { describe, expect, it } from "vitest";
import {
  imageStudioListSchema,
  imageStudioSettingsSchema,
} from "@/schemas/project-image-studio.schema";

import {
  IMAGE_MODELS,
  IMAGE_PLACEMENTS,
  IMAGE_STUDIO_CATALOG,
  imageDimensions,
  imageModel,
  imageModelForEndpoint,
  resolveImageSettings,
} from "./catalog";

const settings = {
  aspectRatio: "1:1",
  resolution: "1K",
  outputFormat: "png",
  seed: null,
};

describe("verified image catalog", () => {
  it("requires the catalog on state and preserves legacy settings plus placement provenance", () => {
    const state = { assets: [], jobs: [], sessions: [], nextCursor: null };
    expect(imageStudioListSchema.safeParse(state).success).toBe(false);
    expect(
      imageStudioListSchema.parse({ ...state, catalog: IMAGE_STUDIO_CATALOG })
        .catalog.models.length,
    ).toBeGreaterThan(0);
    expect(imageStudioSettingsSchema.parse(settings)).toEqual(settings);
    expect(
      imageStudioSettingsSchema.parse({
        ...settings,
        placementId: "pinterest-pin",
      }),
    ).toHaveProperty("placementId", "pinterest-pin");
  });

  it("maps every supported generation/edit endpoint without accepting arbitrary endpoints", () => {
    expect(IMAGE_MODELS.length).toBeGreaterThanOrEqual(3);
    for (const model of IMAGE_MODELS) {
      expect(imageModelForEndpoint(model.generateEndpoint).id).toBe(model.id);
      expect(imageModelForEndpoint(model.editEndpoint).id).toBe(model.id);
      expect(resolveImageSettings(model.id, settings, 4)).toEqual(settings);
    }
    expect(() => imageModel("fal-ai/unverified-model")).toThrow("Unsupported");
    expect(() => imageModelForEndpoint("https://example.com/model")).toThrow(
      "Unsupported",
    );
  });

  it("applies and retains every documented placement, independently of output dimensions", () => {
    for (const placement of IMAGE_PLACEMENTS) {
      const resolved = resolveImageSettings(
        "gemini-flash",
        { ...settings, placementId: placement.id },
        0,
      );
      expect(resolved).toMatchObject({
        placementId: placement.id,
        aspectRatio: placement.aspectRatio,
      });
      expect(placement.sourceUrl).toMatch(/^https:/);
    }
    expect(() =>
      resolveImageSettings(
        undefined,
        { ...settings, placementId: "made-up" },
        0,
      ),
    ).toThrow("placement");
  });

  it.each([
    ["gemini-pro", { resolution: "0.5K" }],
    ["flux-2-pro", { resolution: "0.5K" }],
    ["flux-2-pro", { outputFormat: "webp" }],
    ["gemini-flash", { aspectRatio: "1.91:1" }],
    ["gemini-flash", { resolution: "4K" }],
    ["gemini-flash", { seed: -1 }],
  ])("rejects unsupported settings for %s", (modelId, invalid) => {
    expect(() =>
      resolveImageSettings(modelId, { ...settings, ...invalid }, 0),
    ).toThrow();
  });

  it("rejects reference counts beyond the Studio limit", () => {
    expect(() => resolveImageSettings("flux-2-pro", settings, 5)).toThrow(
      "references",
    );
  });

  it("uses bounded aligned custom dimensions for FLUX rather than platform target pixels", () => {
    expect(imageDimensions("16:9", "2K")).toEqual({
      width: 2048,
      height: 1152,
    });
    expect(imageDimensions("4:5", "1K")).toEqual({ width: 832, height: 1024 });
  });
});
