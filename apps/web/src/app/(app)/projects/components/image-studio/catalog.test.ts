import { describe, expect, it } from "vitest";

import {
  clampToModel,
  defaultModel,
  defaultVideoModel,
  imageRepeatRoute,
  resolveModel,
  settingsOf,
} from "./catalog";
import { TEST_CATALOG } from "./studio-fixtures";
import type { StudioAsset, StudioCatalog, StudioJob } from "./types";

const [MODEL_A, MODEL_B] = TEST_CATALOG.models;

describe("resolveModel", () => {
  it("matches a model by either of its endpoints", () => {
    expect(resolveModel(TEST_CATALOG, MODEL_A.generateEndpoint)).toEqual({
      id: "model-a",
      label: "Model A",
      known: true,
    });
    // An edit and a generate from one model must read as the same model,
    // or a refined image looks like it came from somewhere else.
    expect(resolveModel(TEST_CATALOG, MODEL_A.editEndpoint).id).toBe("model-a");
  });

  it("shows an endpoint it does not know verbatim, rather than guessing", () => {
    const resolved = resolveModel(TEST_CATALOG, "fal-ai/retired-model");
    expect(resolved).toEqual({
      id: null,
      label: "fal-ai/retired-model",
      known: false,
    });
  });
});

describe("clampToModel", () => {
  it("keeps settings the model supports", () => {
    const clamped = clampToModel(MODEL_A, {
      aspectRatio: "9:16",
      resolution: "2K",
      outputFormat: "webp",
      seed: 7,
    });
    expect(clamped).toMatchObject({
      aspectRatio: "9:16",
      resolution: "2K",
      outputFormat: "webp",
      seed: 7,
    });
  });

  it("moves an unsupported value onto something the model does offer", () => {
    // Model B has no 0.5K, no 9:16 and no webp. Carrying those over would
    // buy a rejection after the person had already pressed Generate.
    const clamped = clampToModel(MODEL_B, {
      aspectRatio: "9:16",
      resolution: "0.5K",
      outputFormat: "webp",
      seed: 7,
    });
    expect(MODEL_B.aspectRatios).toContain(clamped.aspectRatio);
    expect(MODEL_B.resolutions).toContain(clamped.resolution);
    expect(MODEL_B.outputFormats).toContain(clamped.outputFormat);
  });

  it("drops a seed a model cannot take", () => {
    expect(clampToModel(MODEL_B, { seed: 7 }).seed).toBeNull();
  });
});

describe("settingsOf", () => {
  it("repeats a version on the terms it was made with", () => {
    const asset = {
      settings: {
        aspectRatio: "9:16",
        resolution: "2K",
        outputFormat: "jpeg",
        seed: 3,
      },
    } as unknown as StudioAsset;

    // The regression this guards: a 9:16 2K image regenerating as a square 1K,
    // because the follow-up was built from defaults instead of from the thing
    // being repeated.
    expect(settingsOf(asset)).toEqual({
      aspectRatio: "9:16",
      resolution: "2K",
      outputFormat: "jpeg",
      seed: 3,
    });
  });

  it("reads a failed job's own terms, not the selection's", () => {
    const job = {
      settings: { aspectRatio: "16:9", resolution: "2K" },
    } as unknown as StudioJob;
    expect(settingsOf(job)).toMatchObject({
      aspectRatio: "16:9",
      resolution: "2K",
    });
  });
});

describe("defaultModel", () => {
  it("honours the catalog's own default", () => {
    expect(defaultModel(TEST_CATALOG)?.id).toBe("model-a");
  });

  it("falls back to the first model when the default is not listed", () => {
    const catalog: StudioCatalog = {
      ...TEST_CATALOG,
      defaultModelId: "a-model-that-was-withdrawn",
    };
    expect(defaultModel(catalog)?.id).toBe("model-a");
  });
});

describe("imageRepeatRoute", () => {
  it("can vary an image from a retired endpoint on the automatic model", () => {
    expect(
      imageRepeatRoute(TEST_CATALOG, { model: "vendor/retired" }, 1),
    ).toEqual({
      model: MODEL_A,
      letterExistingBackdrop: false,
    });
  });

  it.each([
    { editEndpoint: null, maxReferences: 4 },
    { editEndpoint: "vendor/model-a/edit", maxReferences: 0 },
  ])(
    "requires the automatic model to accept the reference: %o",
    (capabilities) => {
      const catalog = {
        ...TEST_CATALOG,
        models: [{ ...MODEL_A, ...capabilities }, MODEL_B],
      };
      expect(
        imageRepeatRoute(catalog, { model: MODEL_B.generateEndpoint }, 1),
      ).toBeNull();
      expect(
        imageRepeatRoute(catalog, { model: MODEL_B.generateEndpoint }, 0)?.model
          .id,
      ).toBe(MODEL_A.id);
    },
  );
});

describe("automatic model selection", () => {
  it("uses the Gemini Pro default from Core", () => {
    const gemini = { ...MODEL_A, id: "gemini-pro" };
    expect(
      defaultModel({
        ...TEST_CATALOG,
        defaultModelId: "gemini-pro",
        models: [...TEST_CATALOG.models, gemini],
      })?.id,
    ).toBe("gemini-pro");
  });

  it("uses H3 Max for both video inputs", () => {
    const [text, image] = TEST_CATALOG.videoModels;
    const catalog = {
      ...TEST_CATALOG,
      defaultAnimateModelId: "h3-max-animate",
      defaultVideoModelId: "h3-max",
      videoModels: [
        ...TEST_CATALOG.videoModels,
        { ...text!, id: "h3-max" },
        { ...image!, id: "h3-max-animate" },
      ],
    };
    expect(defaultVideoModel(catalog, "text")?.id).toBe("h3-max");
    expect(defaultVideoModel(catalog, "image")?.id).toBe("h3-max-animate");
  });
});
