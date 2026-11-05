import {
  type CatalogExclusion,
  defaultSleep,
  deref,
  enumValues,
  type FalModelRow,
  type FalPriceRow,
  type FetchOptions,
  fetchFalModels,
  fetchFalPrices,
  fetchFalSchema,
  findPromptInputSchema,
  oneLine,
  slugFromEndpoint,
  studioSubset,
} from "./fal-catalog-fetch";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS_SECONDS,
  type VideoModel,
} from "./video-model";

/**
 * fal's text-to-video and image-to-video endpoints, read from fal and nowhere
 * else. The video half of {@link ./fal-catalog-fetch}, sharing its paced,
 * backed-off readers.
 *
 * Endpoints verified against the live API on 2026-10-25: the same three as the
 * image crawl, with `category=text-to-video` and `category=image-to-video`.
 */

export const VIDEO_CATEGORIES = ["text-to-video", "image-to-video"] as const;

export interface FalVideoCatalogSources {
  /** Every listed endpoint, tagged with the category it was listed under. */
  models: (FalModelRow & { category: (typeof VIDEO_CATEGORIES)[number] })[];
  prices: Map<string, FalPriceRow>;
  schemas: Map<string, unknown>;
  fetchedAt: string;
}

export interface NormalisedVideoCatalog {
  models: VideoModel[];
  exclusions: CatalogExclusion[];
}

/** fal's per-second units. Anything else does not follow the video's length. */
const PER_SECOND_UNITS: readonly string[] = ["seconds", "second"];

const SCHEMA_CONCURRENCY = 3;
const REQUEST_SPACING_MS = 750;

/**
 * Read the sources for the endpoints the studio could offer, paced like the
 * image crawl.
 *
 * Only `wanted` endpoints are priced and described: a video model is offered
 * only with a hand-verified price, so reading two hundred other schemas would
 * spend fal's rate limit on rows that can never be billed. The listing still
 * runs, because an endpoint fal stops listing must leave the studio.
 */
export async function fetchFalVideoCatalogSources(
  options: FetchOptions,
  wanted: ReadonlySet<string>,
): Promise<FalVideoCatalogSources> {
  const models: FalVideoCatalogSources["models"] = [];
  for (const category of VIDEO_CATEGORIES) {
    for (const row of await fetchFalModels(options, category)) {
      if (wanted.has(row.endpoint_id)) models.push({ ...row, category });
    }
  }
  const endpointIds = models.map((row) => row.endpoint_id);
  const prices = await fetchFalPrices(endpointIds, options);
  const schemaTargets = endpointIds.filter((id) =>
    isPerSecondPrice(prices.get(id)),
  );
  const schemas = new Map<string, unknown>();
  for (
    let index = 0;
    index < schemaTargets.length;
    index += SCHEMA_CONCURRENCY
  ) {
    const batch = schemaTargets.slice(index, index + SCHEMA_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (id) => [id, await fetchFalSchema(id, options)] as const),
    );
    for (const [id, schema] of fetched) {
      if (schema !== null) schemas.set(id, schema);
    }
    options.onProgress?.(
      `video schemas: ${Math.min(index + SCHEMA_CONCURRENCY, schemaTargets.length)}/${schemaTargets.length}`,
    );
    await (options.sleep ?? defaultSleep)(REQUEST_SPACING_MS);
  }
  return { models, prices, schemas, fetchedAt: new Date().toISOString() };
}

function isPerSecondPrice(price: FalPriceRow | undefined): boolean {
  return (
    price !== undefined &&
    typeof price.unit_price === "number" &&
    PER_SECOND_UNITS.includes(price.unit.trim().toLowerCase())
  );
}

/** Where an image-to-video endpoint takes its still, in order of preference. */
const IMAGE_FIELDS = ["image_url", "start_image_url"] as const;

/** Fields the studio fills itself, so a requirement on them is met. */
const STUDIO_FIELDS = new Set(["prompt", "duration", "aspect_ratio"]);

/** The lengths a `duration` property allows, and how it wants them written. */
export function durationOptions(
  document: unknown,
  property: unknown,
): { durations: number[]; encoding: VideoModel["durationEncoding"] } | null {
  const node = deref(document, property);
  if (typeof node !== "object" || node === null) return null;
  const strings = enumValues(document, node);
  if (strings.length > 0) {
    const offered = strings.map(Number);
    return {
      durations: VIDEO_DURATIONS_SECONDS.filter((value) =>
        offered.includes(value),
      ),
      encoding: "string",
    };
  }
  const branches = [
    node,
    ...(["anyOf", "oneOf", "allOf"] as const).flatMap((key) => {
      const value = (node as Record<string, unknown>)[key];
      return Array.isArray(value)
        ? value.map((branch) => deref(document, branch))
        : [];
    }),
  ];
  for (const branch of branches) {
    if (typeof branch !== "object" || branch === null) continue;
    const {
      type,
      minimum,
      maximum,
      enum: values,
    } = branch as Record<string, unknown>;
    if (Array.isArray(values) && values.every((v) => typeof v === "number")) {
      return {
        durations: VIDEO_DURATIONS_SECONDS.filter((value) =>
          (values as number[]).includes(value),
        ),
        encoding: "number",
      };
    }
    if (type !== "integer" && type !== "number") continue;
    const min = typeof minimum === "number" ? minimum : 0;
    const max =
      typeof maximum === "number" ? maximum : Number.POSITIVE_INFINITY;
    return {
      durations: VIDEO_DURATIONS_SECONDS.filter(
        (value) => value >= min && value <= max,
      ),
      encoding: "number",
    };
  }
  return null;
}

/** A primitive default fal publishes for a property, or undefined. */
function primitiveDefault(
  document: unknown,
  property: unknown,
): string | number | boolean | undefined {
  const node = deref(document, property);
  if (typeof node !== "object" || node === null) return undefined;
  const value = (node as { default?: unknown }).default;
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

/**
 * Turn fal's payloads into studio video rows.
 *
 * Nothing is invented: a fact fal does not publish — a per-second price, a
 * length control, a field the studio cannot fill — becomes an exclusion with a
 * reason, never a default that looks like knowledge.
 */
export function normaliseFalVideoCatalog(
  sources: FalVideoCatalogSources,
): NormalisedVideoCatalog {
  const verifiedAt = sources.fetchedAt.slice(0, 10);
  const models: VideoModel[] = [];
  const exclusions: CatalogExclusion[] = [];
  const takenIds = new Set<string>();
  const exclude = (endpointId: string, reason: string) =>
    exclusions.push({ endpointId, reason });

  for (const row of sources.models) {
    const endpointId = row.endpoint_id;
    const price = sources.prices.get(endpointId);
    if (!price || typeof price.unit_price !== "number") {
      exclude(endpointId, "fal published no price for this endpoint.");
      continue;
    }
    if (!isPerSecondPrice(price)) {
      exclude(
        endpointId,
        `Priced by ${price.unit}, which does not follow the video's length, so it cannot be charged for per second.`,
      );
      continue;
    }
    const document = sources.schemas.get(endpointId);
    if (document === undefined) {
      exclude(
        endpointId,
        "fal published no queue schema, so its inputs are unknown.",
      );
      continue;
    }
    const schema = findPromptInputSchema(document);
    if (!schema) {
      exclude(endpointId, "No input schema takes a prompt.");
      continue;
    }
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (name): name is string => typeof name === "string",
        )
      : [];

    const input: VideoModel["input"] =
      row.category === "image-to-video" ? "image" : "text";
    const imageField =
      input === "image"
        ? (IMAGE_FIELDS.find((field) => field in properties) ?? null)
        : null;
    if (input === "image" && !imageField) {
      exclude(
        endpointId,
        "No `image_url` or `start_image_url`, so the studio cannot hand it a still.",
      );
      continue;
    }

    const fixedInput: VideoModel["fixedInput"] = {};
    const unmet = required.find((field) => {
      if (STUDIO_FIELDS.has(field) || field === imageField) return false;
      const fallback = primitiveDefault(document, properties[field]);
      if (fallback === undefined) return true;
      fixedInput[field] = fallback;
      return false;
    });
    if (unmet) {
      exclude(
        endpointId,
        `Requires \`${unmet}\`, which the studio has no control for and fal gives no default.`,
      );
      continue;
    }

    const duration =
      "duration" in properties
        ? durationOptions(document, properties.duration)
        : null;
    if (!duration || duration.durations.length === 0) {
      exclude(
        endpointId,
        "No `duration` accepting 5, 10 or 15 seconds, so the length — and the price — is not the studio's to set.",
      );
      continue;
    }

    let aspectRatios: string[] = [];
    if (input === "text" && "aspect_ratio" in properties) {
      aspectRatios = studioSubset(
        enumValues(document, properties.aspect_ratio),
        VIDEO_ASPECT_RATIOS,
      );
      if (aspectRatios.length === 0) {
        exclude(endpointId, "No `aspect_ratio` the studio offers.");
        continue;
      }
    }

    const id = slugFromEndpoint(endpointId);
    if (takenIds.has(id)) {
      exclude(
        endpointId,
        `Slug \`${id}\` is already taken by another endpoint.`,
      );
      continue;
    }
    takenIds.add(id);

    const unit = price.unit.trim().toLowerCase();
    const resolutions =
      "resolution" in properties
        ? enumValues(document, properties.resolution)
        : [];
    models.push({
      id,
      label: row.metadata?.display_name?.trim() || id,
      description: oneLine(row.metadata?.description ?? ""),
      endpoint: endpointId,
      input,
      imageField,
      aspectRatios,
      durations: duration.durations,
      durationEncoding: duration.encoding,
      resolutions,
      fixedInput,
      curatedRank: null,
      notes:
        input === "image"
          ? "Capabilities read from fal's own queue schema. The frame follows the image."
          : "Capabilities read from fal's own queue schema.",
      price: {
        unit,
        unitPriceUsd: price.unit_price,
        basis: `fal's pricing API lists $${price.unit_price} per second, which for video is the cheapest resolution tier. Not billed until a person verifies the per-resolution figures.`,
        sourceUrl: `https://fal.ai/models/${endpointId}`,
        verifiedAt,
      },
      sourceUrls: [
        row.metadata?.model_url ?? `https://fal.ai/models/${endpointId}`,
      ],
      verifiedAt,
    });
  }
  return { models, exclusions };
}
