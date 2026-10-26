import { describe, expect, it, vi } from "vitest";

import {
  durationOptions,
  type FalVideoCatalogSources,
  fetchFalVideoCatalogSources,
  normaliseFalVideoCatalog,
} from "./fal-video-catalog-fetch";

/** An OpenAPI document in the shape fal's queue schema route returns. */
function openApi(
  properties: Record<string, unknown>,
  required: string[] = ["prompt"],
) {
  return {
    components: {
      schemas: {
        VideoInput: { type: "object", properties, required },
        VideoOutput: { type: "object", properties: { video: {} } },
      },
    },
  };
}

/** Trimmed from `minimax/h3-max-turbo/text-to-video` as fal published it. */
const H3_TEXT = openApi(
  {
    prompt: { type: "string" },
    duration: { type: "number", minimum: 0.92, maximum: 15, default: 5 },
    resolution: { type: "string", enum: ["480P", "768P", "1080P"] },
    aspect_ratio: {
      type: "string",
      enum: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
    prompt_expansion_mode: { type: "string", default: "balanced" },
  },
  ["prompt", "prompt_expansion_mode"],
);

/** Trimmed from `kling/v4/image-to-video`. */
const KLING_IMAGE = openApi(
  {
    prompt: { anyOf: [{ type: "string" }, { type: "null" }] },
    start_image_url: { type: "string" },
    duration: { type: "integer", minimum: 3, maximum: 30, default: 5 },
    resolution: { type: "string", enum: ["720p", "1080p"] },
  },
  ["start_image_url"],
);

function sources(
  rows: Array<{
    endpoint: string;
    category: "text-to-video" | "image-to-video";
    unit?: string;
    schema?: unknown;
  }>,
): FalVideoCatalogSources {
  return {
    models: rows.map((row) => ({
      endpoint_id: row.endpoint,
      category: row.category,
      metadata: { display_name: row.endpoint, description: "A model." },
    })),
    prices: new Map(
      rows.map((row) => [
        row.endpoint,
        {
          endpoint_id: row.endpoint,
          unit: row.unit ?? "seconds",
          unit_price: 0.1,
        },
      ]),
    ),
    schemas: new Map(
      rows
        .filter((row) => row.schema !== undefined)
        .map((row) => [row.endpoint, row.schema]),
    ),
    fetchedAt: "2026-10-25T00:00:00.000Z",
  };
}

describe("normaliseFalVideoCatalog", () => {
  it("reads lengths, frames, resolutions and required defaults off the schema", () => {
    const { models, exclusions } = normaliseFalVideoCatalog(
      sources([
        {
          endpoint: "a/b/text-to-video",
          category: "text-to-video",
          schema: H3_TEXT,
        },
      ]),
    );
    expect(exclusions).toEqual([]);
    expect(models[0]).toMatchObject({
      input: "text",
      imageField: null,
      durations: [5, 10, 15],
      durationEncoding: "number",
      aspectRatios: ["9:16", "16:9", "1:1", "4:3", "3:4"],
      resolutions: ["480P", "768P", "1080P"],
      fixedInput: { prompt_expansion_mode: "balanced" },
    });
  });

  it("finds an image-to-video model's still field and caps lengths to the studio's", () => {
    const { models } = normaliseFalVideoCatalog(
      sources([
        {
          endpoint: "k/v4/image-to-video",
          category: "image-to-video",
          schema: KLING_IMAGE,
        },
      ]),
    );
    expect(models[0]).toMatchObject({
      input: "image",
      imageField: "start_image_url",
      aspectRatios: [],
      durations: [5, 10, 15],
    });
  });

  it("excludes what it cannot drive or price, saying why", () => {
    const avatar = openApi(
      {
        prompt: { type: "string" },
        image_url: { type: "string" },
        audio_url: { type: "string" },
        duration: { type: "number" },
      },
      ["image_url", "audio_url"],
    );
    const noDuration = openApi({ prompt: { type: "string" } });
    const { models, exclusions } = normaliseFalVideoCatalog(
      sources([
        {
          endpoint: "x/per-video",
          category: "text-to-video",
          unit: "videos",
          schema: H3_TEXT,
        },
        { endpoint: "x/avatar", category: "image-to-video", schema: avatar },
        { endpoint: "x/fixed", category: "text-to-video", schema: noDuration },
        { endpoint: "x/no-schema", category: "text-to-video" },
      ]),
    );
    expect(models).toEqual([]);
    const reasons = Object.fromEntries(
      exclusions.map((exclusion) => [exclusion.endpointId, exclusion.reason]),
    );
    expect(reasons["x/per-video"]).toMatch(/videos/);
    expect(reasons["x/avatar"]).toMatch(/audio_url/);
    expect(reasons["x/fixed"]).toMatch(/duration/);
    expect(reasons["x/no-schema"]).toMatch(/schema/);
  });
});

describe("durationOptions", () => {
  it("reads an enum of strings as string-encoded lengths", () => {
    expect(durationOptions({}, { type: "string", enum: ["5", "10"] })).toEqual({
      durations: [5, 10],
      encoding: "string",
    });
  });
});

describe("fetchFalVideoCatalogSources", () => {
  it("prices and describes only the endpoints asked for", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      urls.push(input);
      const url = new URL(input);
      if (url.pathname === "/v1/models")
        return new Response(
          JSON.stringify({
            models:
              url.searchParams.get("category") === "text-to-video"
                ? [
                    { endpoint_id: "wanted/text-to-video" },
                    { endpoint_id: "other/text-to-video" },
                  ]
                : [],
            has_more: false,
          }),
        );
      if (url.pathname === "/v1/models/pricing")
        return new Response(
          JSON.stringify({
            prices: [
              {
                endpoint_id: "wanted/text-to-video",
                unit: "seconds",
                unit_price: 0.1,
              },
            ],
          }),
        );
      return new Response(JSON.stringify(H3_TEXT));
    });

    const result = await fetchFalVideoCatalogSources(
      { fetchImpl, apiKey: "k", sleep: async () => {} },
      new Set(["wanted/text-to-video"]),
    );

    expect(result.models.map((row) => row.endpoint_id)).toEqual([
      "wanted/text-to-video",
    ]);
    expect(urls.some((url) => url.includes("other%2Ftext-to-video"))).toBe(
      false,
    );
    expect(result.schemas.has("wanted/text-to-video")).toBe(true);
  });
});
