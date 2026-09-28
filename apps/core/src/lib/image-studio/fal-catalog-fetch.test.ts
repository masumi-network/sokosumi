import { describe, expect, it, vi } from "vitest";

import { applyCatalogOverrides } from "./catalog-overrides";
import {
  excludeUnpriceableModels,
  type FalCatalogSources,
  type FalModelRow,
  type FalPriceRow,
  fetchFalPrices,
  findPromptInputSchema,
  isRefineVariantEndpoint,
  normaliseFalCatalog,
} from "./fal-catalog-fetch";
import { creditsPerImage } from "./image-model";

/**
 * Fixtures are cut down from real payloads captured on 2026-09-27 — the same
 * crawl that produced the committed snapshot — so the shapes here are fal's, not
 * a convenient invention. Nothing in this file touches the network.
 */

/** An `aspect_ratio` enum wrapped in `anyOf` with null, as fal actually ships it. */
function aspectRatioInputSchema(overrides: Record<string, unknown> = {}) {
  return {
    components: {
      schemas: {
        TextToImageInput: {
          properties: {
            prompt: { type: "string" },
            aspect_ratio: {
              anyOf: [
                { enum: ["1:1", "16:9", "9:16", "21:9", "4:5"] },
                { type: "null" },
              ],
            },
            resolution: { enum: ["1K", "2K", "4K"] },
            output_format: { enum: ["jpeg", "png"] },
            num_images: { type: "integer" },
            seed: { type: "integer" },
            ...overrides,
          },
          required: ["prompt"],
        },
      },
    },
  };
}

/** `image_size` as a named-size enum *or* explicit width/height, via `$ref`. */
function imageSizeInputSchema() {
  return {
    components: {
      schemas: {
        ImageSize: {
          properties: {
            width: { type: "integer" },
            height: { type: "integer" },
          },
        },
        FluxInput: {
          properties: {
            prompt: { type: "string" },
            image_size: {
              anyOf: [
                { $ref: "#/components/schemas/ImageSize" },
                { enum: ["square_hd", "portrait_4_3"] },
              ],
            },
            output_format: { enum: ["jpeg", "png"] },
            seed: { type: "integer" },
          },
          required: ["prompt"],
        },
      },
    },
  };
}

function modelRow(endpointId: string, displayName: string): FalModelRow {
  return {
    endpoint_id: endpointId,
    metadata: {
      display_name: displayName,
      description: `${displayName} generates images.`,
      category: "text-to-image",
      status: "active",
      model_url: `https://fal.run/${endpointId}`,
    },
  };
}

function price(
  endpointId: string,
  unit: string,
  unitPrice: number,
): FalPriceRow {
  return {
    endpoint_id: endpointId,
    unit,
    unit_price: unitPrice,
    currency: "USD",
  };
}

function sources(
  entries: Array<{
    row: FalModelRow;
    price?: FalPriceRow;
    schema?: unknown;
  }>,
  editEndpoints: string[] = [],
): FalCatalogSources {
  return {
    models: entries.map((entry) => entry.row),
    prices: new Map(
      entries
        .filter((entry) => entry.price)
        .map((entry) => [entry.row.endpoint_id, entry.price!]),
    ),
    schemas: new Map(
      entries
        .filter((entry) => entry.schema !== undefined)
        .map((entry) => [entry.row.endpoint_id, entry.schema]),
    ),
    editEndpoints: new Set(editEndpoints),
    fetchedAt: "2026-09-27T10:00:00.000Z",
  };
}

describe("findPromptInputSchema", () => {
  it("picks the request schema by the presence of `prompt`, not by its name", () => {
    const document = {
      components: {
        schemas: {
          ImageOutput: { properties: { images: {} } },
          SomeModelInput: { properties: { prompt: {}, seed: {} } },
        },
      },
    };
    expect(findPromptInputSchema(document)).toMatchObject({
      properties: { prompt: {} },
    });
    expect(findPromptInputSchema({ components: { schemas: {} } })).toBeNull();
  });
});

describe("normaliseFalCatalog", () => {
  it("normalises an aspect-ratio model down to the studio's own vocabulary", () => {
    const { models } = normaliseFalCatalog(
      sources([
        {
          row: modelRow("fal-ai/example-flash", "Example Flash"),
          price: price("fal-ai/example-flash", "images", 0.04),
          schema: aspectRatioInputSchema(),
        },
      ]),
    );
    expect(models).toHaveLength(1);
    const model = models[0]!;
    // 21:9 is offered by fal and dropped here: the studio has no control for it
    // and no dimension maths, so it is not a capability the studio has.
    expect(model.aspectRatios).toEqual(["1:1", "16:9", "9:16", "4:5"]);
    // 4K likewise: the studio's tiers stop at 2K.
    expect(model.resolutions).toEqual(["1K", "2K"]);
    expect(model.outputFormats).toEqual(["png", "jpeg"]);
    expect(model).toMatchObject({
      id: "example-flash",
      label: "Example Flash",
      dimensionMode: "aspect-ratio",
      supportsSeed: true,
      editEndpoint: null,
      maxReferences: 0,
      curatedRank: null,
    });
    expect(model.price).toMatchObject({ unit: "images", unitPriceUsd: 0.04 });
  });

  it("normalises a model that takes explicit dimensions instead of a ratio", () => {
    const { models } = normaliseFalCatalog(
      sources([
        {
          row: modelRow("fal-ai/example-flux", "Example FLUX"),
          price: price("fal-ai/example-flux", "megapixels", 0.03),
          schema: imageSizeInputSchema(),
        },
      ]),
    );
    const model = models[0]!;
    expect(model.dimensionMode).toBe("image-size");
    expect(model.resolutions).toEqual(["1K", "2K"]);
    expect(model.providerFields).toEqual([
      "image_size",
      "output_format",
      "seed",
    ]);
    // Area-priced, so the charge follows the frame the studio asks for.
    expect(
      creditsPerImage(model, { aspectRatio: "1:1", resolution: "1K" }),
    ).toBe(4);
    expect(
      creditsPerImage(model, { aspectRatio: "16:9", resolution: "1K" }),
    ).toBe(2);
  });

  it("attaches the /edit variant from fal's image-to-image listing", () => {
    const { models } = normaliseFalCatalog(
      sources(
        [
          {
            row: modelRow("fal-ai/example-flash", "Example Flash"),
            price: price("fal-ai/example-flash", "images", 0.04),
            schema: aspectRatioInputSchema(),
          },
        ],
        ["fal-ai/example-flash/edit"],
      ),
    );
    expect(models[0]).toMatchObject({
      editEndpoint: "fal-ai/example-flash/edit",
      maxReferences: 4,
    });
    // The provider field follows: only the edit endpoint accepts references.
    expect(models[0]!.providerFields).toContain("image_urls");
  });

  it("omits a provider field the endpoint does not declare", () => {
    const schema = aspectRatioInputSchema();
    // A model with no `resolution` and no `seed` — the common case outside the
    // Gemini family, and sending either would earn a 422.
    delete (
      schema.components.schemas.TextToImageInput.properties as Record<
        string,
        unknown
      >
    ).resolution;
    delete (
      schema.components.schemas.TextToImageInput.properties as Record<
        string,
        unknown
      >
    ).seed;
    const { models } = normaliseFalCatalog(
      sources([
        {
          row: modelRow("fal-ai/example-plain", "Example Plain"),
          price: price("fal-ai/example-plain", "images", 0.02),
          schema,
        },
      ]),
    );
    expect(models[0]!.providerFields).toEqual([
      "aspect_ratio",
      "output_format",
      "num_images",
    ]);
    expect(models[0]!.supportsSeed).toBe(false);
    // No resolution control means the model picks its own pixels; the studio
    // still needs one tier to price and to store.
    expect(models[0]!.resolutions).toEqual(["1K"]);
  });

  it.each([
    [
      "a refine variant",
      "fal-ai/example/edit",
      /Refine variant/,
      { price: true, schema: true },
    ],
    [
      "an endpoint fal publishes no price for",
      "fal-ai/example-unpriced",
      /no price/,
      { price: false, schema: true },
    ],
    [
      "an endpoint fal publishes no schema for",
      "fal-ai/example-unschemad",
      /no queue schema/,
      { price: true, schema: false },
    ],
  ])("excludes %s with a reason", (_label, endpointId, reason, has) => {
    const { models, exclusions } = normaliseFalCatalog(
      sources([
        {
          row: modelRow(endpointId, "Example"),
          ...(has.price ? { price: price(endpointId, "images", 0.01) } : {}),
          ...(has.schema ? { schema: aspectRatioInputSchema() } : {}),
        },
      ]),
    );
    expect(models).toHaveLength(0);
    expect(exclusions).toHaveLength(1);
    expect(exclusions[0]).toMatchObject({ endpointId });
    expect(exclusions[0]!.reason).toMatch(reason);
  });

  it("excludes an endpoint whose schema takes no prompt", () => {
    const { models, exclusions } = normaliseFalCatalog(
      sources([
        {
          row: modelRow("fal-ai/example-upscale", "Example Upscale"),
          price: price("fal-ai/example-upscale", "images", 0.01),
          schema: {
            components: {
              schemas: { UpscaleInput: { properties: { image_url: {} } } },
            },
          },
        },
      ]),
    );
    expect(models).toHaveLength(0);
    expect(exclusions[0]!.reason).toMatch(/takes a prompt/);
  });

  it("excludes an endpoint that requires an input image", () => {
    const { models, exclusions } = normaliseFalCatalog(
      sources([
        {
          row: modelRow("fal-ai/example-restyle", "Example Restyle"),
          price: price("fal-ai/example-restyle", "images", 0.01),
          schema: {
            components: {
              schemas: {
                RestyleInput: {
                  properties: {
                    prompt: {},
                    image_url: {},
                    aspect_ratio: { enum: ["1:1"] },
                  },
                  required: ["prompt", "image_url"],
                },
              },
            },
          },
        },
      ]),
    );
    expect(models).toHaveLength(0);
    expect(exclusions[0]!.reason).toMatch(/Requires `image_url`/);
  });

  it("excludes an endpoint whose frame cannot be controlled at all", () => {
    const { models, exclusions } = normaliseFalCatalog(
      sources([
        {
          row: modelRow("fal-ai/example-fixed", "Example Fixed"),
          price: price("fal-ai/example-fixed", "images", 0.01),
          schema: {
            components: {
              schemas: {
                FixedInput: {
                  properties: {
                    prompt: {},
                    image_size: { enum: ["square_hd"] },
                  },
                  required: ["prompt"],
                },
              },
            },
          },
        },
      ]),
    );
    expect(models).toHaveLength(0);
    expect(exclusions[0]!.reason).toMatch(/frame cannot be controlled/);
  });

  it("recognises the refine variants it must not offer as their own row", () => {
    expect(isRefineVariantEndpoint("fal-ai/flux-2-pro/edit")).toBe(true);
    expect(isRefineVariantEndpoint("fal-ai/flux/lora/edit")).toBe(true);
    expect(isRefineVariantEndpoint("fal-ai/flux-2-pro/inpaint")).toBe(true);
    // A legitimate three-segment base endpoint is not a variant.
    expect(isRefineVariantEndpoint("fal-ai/recraft/v3/text-to-image")).toBe(
      false,
    );
    expect(isRefineVariantEndpoint("fal-ai/ideogram/v3")).toBe(false);
  });
});

describe("excludeUnpriceableModels", () => {
  /** `schema` decides who picks the output size, which is half the question. */
  function normalise(unit: string, schema: unknown = aspectRatioInputSchema()) {
    return normaliseFalCatalog(
      sources([
        {
          row: modelRow("fal-ai/example-slow", "Example Slow"),
          price: price("fal-ai/example-slow", unit, 0.002),
          schema,
        },
      ]),
    ).models;
  }

  it.each(["compute seconds", "units", "credits"])(
    "drops a model priced by %s rather than guessing what one image costs",
    (unit) => {
      const { models, exclusions } = excludeUnpriceableModels(normalise(unit));
      expect(models).toHaveLength(0);
      expect(exclusions[0]!.reason).toMatch(new RegExp(`Priced by ${unit}`));
    },
  );

  it.each(["images", "generations"])(
    "keeps a model priced by %s, whoever picks the size",
    (unit) => {
      expect(excludeUnpriceableModels(normalise(unit)).models).toHaveLength(1);
      expect(
        excludeUnpriceableModels(normalise(unit, imageSizeInputSchema()))
          .models,
      ).toHaveLength(1);
    },
  );

  it.each(["megapixels", "processed megapixels"])(
    "keeps a model priced by %s only when the studio sets the dimensions",
    (unit) => {
      // The studio tells an `image_size` model exactly what to produce, so the
      // area it bills is the area that was asked for.
      expect(
        excludeUnpriceableModels(normalise(unit, imageSizeInputSchema()))
          .models,
      ).toHaveLength(1);

      // An `aspect_ratio` model returns whatever size it likes. Pricing the
      // studio's guess undercharged `fal-ai/nucleus-image` by half on preview.
      const { models, exclusions } = excludeUnpriceableModels(normalise(unit));
      expect(models).toHaveLength(0);
      expect(exclusions[0]!.reason).toMatch(/provider picks the output size/);
    },
  );

  it("lets hand-verified per-tier figures rescue such a model", () => {
    const [model] = normalise("megapixels");
    expect(model!.resolutions).toEqual(["1K", "2K"]);
    // Every tier the model offers needs a figure. A table covering only 1K leaves
    // 2K unpriceable, and the model stays out — half a price is not a price.
    expect(
      excludeUnpriceableModels([
        { ...model!, price: { ...model!.price, perImageUsd: { "1K": 0.02 } } },
      ]).models,
    ).toHaveLength(0);
    expect(
      excludeUnpriceableModels([
        {
          ...model!,
          price: { ...model!.price, perImageUsd: { "1K": 0.02, "2K": 0.05 } },
        },
      ]).models,
    ).toHaveLength(1);
  });
});

describe("applyCatalogOverrides", () => {
  it("merges the hand-verified layer onto the fetched row, field by field", () => {
    const fetched = normaliseFalCatalog(
      sources(
        [
          {
            // fal's own row would give this a slug id and a generated label.
            row: modelRow(
              "fal-ai/gemini-3.1-flash-image-preview",
              "Nano Banana 2",
            ),
            price: price(
              "fal-ai/gemini-3.1-flash-image-preview",
              "images",
              0.08,
            ),
            schema: aspectRatioInputSchema(),
          },
        ],
        ["fal-ai/gemini-3.1-flash-image-preview/edit"],
      ),
    ).models;
    expect(fetched[0]!.id).toBe("gemini-3-1-flash-image-preview");

    const [overridden] = applyCatalogOverrides(fetched);
    // The override renames it to the short id clients already store, and pins
    // the per-tier prices fal's pricing endpoint does not publish.
    expect(overridden).toMatchObject({
      id: "gemini-flash",
      label: "Gemini 3.1 Flash Image",
      curatedRank: 1,
      resolutions: ["0.5K", "1K", "2K"],
    });
    expect(overridden!.price).toMatchObject({
      // fal's unit survives underneath the verified table.
      unit: "images",
      unitPriceUsd: 0.08,
      perImageUsd: { "0.5K": 0.06, "1K": 0.08, "2K": 0.12 },
    });
    // The endpoint fal reported is untouched; an override never invents one.
    expect(overridden!.generateEndpoint).toBe(
      "fal-ai/gemini-3.1-flash-image-preview",
    );
  });

  it("leaves a model fal describes fully exactly as fetched", () => {
    const fetched = normaliseFalCatalog(
      sources([
        {
          row: modelRow("fal-ai/example-unlisted", "Example Unlisted"),
          price: price("fal-ai/example-unlisted", "images", 0.01),
          schema: aspectRatioInputSchema(),
        },
      ]),
    ).models;
    expect(applyCatalogOverrides(fetched)).toEqual(fetched);
  });
});

describe("fetchFalPrices", () => {
  it("batches many endpoint ids per call and keys the answer by id", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const ids = [...new URL(url).searchParams.getAll("endpoint_id")];
      return new Response(
        JSON.stringify({
          prices: ids.map((id) => price(id, "images", 0.01)),
        }),
        { status: 200 },
      );
    });
    const ids = Array.from({ length: 45 }, (_, index) => `fal-ai/m${index}`);
    const prices = await fetchFalPrices(ids, {
      fetchImpl,
      apiKey: "k",
      sleep: async () => {},
    });
    expect(prices.size).toBe(45);
    // 45 ids at 20 per call. One call per id would be 45 reads into a rate limit
    // that already refuses seven a second.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("backs off a 429 and keeps the eventual answer", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) return new Response("rate limited", { status: 429 });
      return new Response(
        JSON.stringify({ prices: [price("fal-ai/m", "images", 0.05)] }),
        { status: 200 },
      );
    });
    const slept: number[] = [];
    const prices = await fetchFalPrices(["fal-ai/m"], {
      fetchImpl,
      apiKey: "k",
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(prices.get("fal-ai/m")).toMatchObject({ unit_price: 0.05 });
    // Growing waits, not a tight loop: a tight retry is what earns the 429 next.
    expect(slept.slice(0, 2)).toEqual([3_000, 6_000]);
  });

  it("gives up on a 4xx instead of hammering a request that is simply wrong", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("bad request", { status: 400 }),
    );
    await expect(
      fetchFalPrices(["fal-ai/m"], {
        fetchImpl,
        apiKey: "k",
        sleep: async () => {},
      }),
    ).rejects.toThrow("400");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
