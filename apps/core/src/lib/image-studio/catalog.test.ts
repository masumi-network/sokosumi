import { describe, expect, it } from "vitest";

import {
  imageStudioCatalogSchema,
  imageStudioListSchema,
  imageStudioSettingsSchema,
} from "@/schemas/project-image-studio.schema";
import {
  findImageModelForEndpoint,
  getImageCatalog,
  imageModel,
  imageModelForEndpoint,
  resolveImageSettings,
} from "./catalog";
import { CURATED_MODEL_IDS } from "./catalog-overrides";
import {
  creditsPerImage,
  DEFAULT_IMAGE_MODEL_ID,
  imageDimensions,
} from "./image-model";

const settings = {
  aspectRatio: "1:1",
  resolution: "1K",
  outputFormat: "png",
  seed: null,
};

describe("resolved image catalog", () => {
  it("serves the whole fal catalog from the committed snapshot, with no network", () => {
    const catalog = getImageCatalog();
    // The point of the snapshot: a cold instance that has never spoken to fal
    // still offers the real catalog rather than three hard-coded rows.
    expect(catalog.models.length).toBeGreaterThan(100);
    expect(catalog.refreshedAt).toBeNull();
    expect(catalog.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(imageStudioCatalogSchema.safeParse(catalog).success).toBe(true);
  });

  it("no longer rides inside the polled project state", () => {
    // It used to, and with ~150 models a three-second poll was re-sending the
    // entire catalog. It has its own cached route now.
    const state = { assets: [], jobs: [], sessions: [], nextCursor: null };
    expect(imageStudioListSchema.safeParse(state).success).toBe(true);
    expect(imageStudioSettingsSchema.parse(settings)).toEqual(settings);
  });

  it("opens on the studio default and offers the curated five first, in order", () => {
    const catalog = getImageCatalog();
    expect(catalog.defaultModelId).toBe(DEFAULT_IMAGE_MODEL_ID);
    expect(catalog.models.slice(0, 5).map((model) => model.id)).toEqual([
      ...CURATED_MODEL_IDS,
    ]);
    expect(
      catalog.models.slice(0, 5).map((model) => model.curatedRank),
    ).toEqual([1, 2, 3, 4, 5]);
    // Everything after the shortlist is unranked, so no client has to hold its
    // own list to know which five come first.
    for (const model of catalog.models.slice(5)) {
      expect(model.curatedRank).toBeNull();
    }
  });

  it("keeps the hand-verified rows for the three models a person checked", () => {
    expect(imageModel("gemini-flash")).toMatchObject({
      label: "Gemini 3.1 Flash Image",
      generateEndpoint: "fal-ai/gemini-3.1-flash-image-preview",
      editEndpoint: "fal-ai/gemini-3.1-flash-image-preview/edit",
      resolutions: ["0.5K", "1K", "2K"],
      dimensionMode: "aspect-ratio",
      maxReferences: 4,
    });
    expect(imageModel("gemini-pro").resolutions).toEqual(["1K", "2K"]);
    expect(imageModel("flux-2-pro")).toMatchObject({
      dimensionMode: "image-size",
      outputFormats: ["png", "jpeg"],
    });
    // The override's verified price survives the fetched row underneath it.
    expect(imageModel("gemini-flash").price.perImageUsd).toEqual({
      "0.5K": 0.06,
      "1K": 0.08,
      "2K": 0.12,
    });
  });

  it("maps every catalog endpoint back to its model, and nothing else", () => {
    for (const model of getImageCatalog().models) {
      expect(imageModelForEndpoint(model.generateEndpoint).id).toBe(model.id);
      if (model.editEndpoint) {
        expect(imageModelForEndpoint(model.editEndpoint).id).toBe(model.id);
      }
    }
    expect(() => imageModel("fal-ai/unverified-model")).toThrow("Unsupported");
    expect(() => imageModelForEndpoint("https://example.com/model")).toThrow(
      "Unsupported",
    );
  });

  it("answers null rather than throwing for an endpoint the catalog dropped", () => {
    // A stored job keeps its endpoint for ever, and history has to be able to
    // name a model fal has since withdrawn without taking the feed down.
    expect(findImageModelForEndpoint("fal-ai/withdrawn-last-year")).toBeNull();
  });

  it("gives every model a price it can actually be charged for", () => {
    for (const model of getImageCatalog().models) {
      expect(model.resolutions.length).toBeGreaterThan(0);
      for (const resolution of model.resolutions) {
        for (const aspectRatio of model.aspectRatios) {
          expect(
            creditsPerImage(model, { aspectRatio, resolution }),
            `${model.id} cannot be priced at ${aspectRatio} ${resolution}`,
          ).toBeGreaterThan(0);
        }
      }
      // A figure about money has to say where it came from and when.
      expect(model.price.sourceUrl).toMatch(/^https:/);
      expect(model.price.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(model.price.basis.length).toBeGreaterThan(0);
    }
  });

  it("charges the curated five what the shared contract says they cost", () => {
    const square1K = { aspectRatio: "1:1", resolution: "1K" };
    expect(creditsPerImage(imageModel("gemini-flash"), square1K)).toBe(8);
    expect(creditsPerImage(imageModel("gemini-pro"), square1K)).toBe(15);
    expect(creditsPerImage(imageModel("ideogram-v3"), square1K)).toBe(3);
    expect(creditsPerImage(imageModel("recraft-v3"), square1K)).toBe(4);
    // flux-2-pro is priced by area, so its charge follows the frame rather than
    // sitting at one number: $0.03/MP over 1024x1024.
    expect(creditsPerImage(imageModel("flux-2-pro"), square1K)).toBe(4);
    expect(
      creditsPerImage(imageModel("flux-2-pro"), {
        aspectRatio: "16:9",
        resolution: "1K",
      }),
    ).toBe(2);
  });

  it("prices no resolution a model cannot run", () => {
    for (const model of getImageCatalog().models) {
      for (const priced of Object.keys(model.price.perImageUsd ?? {})) {
        expect(model.resolutions).toContain(priced);
      }
    }
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

  it("refuses a reference for a model fal lists no edit endpoint for", () => {
    const withoutEdit = getImageCatalog().models.find(
      (model) => model.editEndpoint === null,
    );
    expect(withoutEdit).toBeDefined();
    expect(withoutEdit?.maxReferences).toBe(0);
    // Degrades to a clear refusal rather than silently sending a refinement to
    // the generate endpoint, which would drop the references and charge for an
    // unrelated fresh image.
    expect(() =>
      resolveImageSettings(
        withoutEdit!.id,
        { ...settings, resolution: withoutEdit!.resolutions[0]! },
        1,
      ),
    ).toThrow("cannot refine");
  });

  it("rejects reference counts beyond the Studio limit", () => {
    expect(() => resolveImageSettings("flux-2-pro", settings, 5)).toThrow(
      "references",
    );
  });

  it("uses bounded aligned custom dimensions rather than platform target pixels", () => {
    expect(imageDimensions("16:9", "2K")).toEqual({
      width: 2048,
      height: 1152,
    });
    expect(imageDimensions("4:5", "1K")).toEqual({ width: 832, height: 1024 });
  });
});
