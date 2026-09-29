import { IMAGE_PRICE_UNITS, type ImagePriceUnit } from "@sokosumi/utils";

import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_PROVIDER_FIELDS,
  IMAGE_RESOLUTIONS,
  type ImageModel,
  type ImageProviderField,
  isUnchargeableModel,
  unchargeableReason,
} from "./image-model";

/**
 * Everything the studio knows about fal's text-to-image endpoints, read from
 * fal and nowhere else.
 *
 * Three sources, because fal publishes three different facts in three places:
 * what endpoints exist, what they cost, and what they accept. None of them is
 * derivable from another, and guessing any of them is how a studio offers a
 * control the model does not have or quotes a price that is not the price.
 *
 * Every function here takes its `fetch` as an argument. That is not ceremony:
 * a catalog is exactly the kind of thing that must be testable against fixtures
 * of real provider payloads, and a module that reaches for global `fetch`
 * cannot be. Nothing here touches a database, a cache, or the environment.
 *
 * Endpoints verified against the live API on 2026-09-27:
 * - `GET https://api.fal.ai/v1/models?category=text-to-image&status=active`
 *   with `Authorization: Key <FAL_KEY>`, cursor-paginated on `next_cursor`.
 * - `GET https://api.fal.ai/v1/models/pricing?endpoint_id=A&endpoint_id=B…`
 *   many ids per call.
 * - `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`
 *   on the fal.ai host, no auth, needs an ordinary User-Agent.
 */

/**
 * One line for the model picker: the first sentence, cut at a word boundary if
 * it is still long. fal's descriptions run to a paragraph of marketing copy.
 */
export function oneLine(text: string, max = 90): string {
  const first =
    text
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s/)[0] ?? "";
  const sentence = first.replace(/\.$/, "");
  if (sentence.length <= max) return sentence;
  const head = sentence.slice(0, max);
  // Prefer ending on a clause, so the line never stops mid-phrase.
  const clause = head.lastIndexOf(", ");
  if (clause >= 30) return head.slice(0, clause);
  return `${head.replace(/\s+\S*$/, "")}…`;
}

const MODELS_URL = "https://api.fal.ai/v1/models";
const PRICING_URL = "https://api.fal.ai/v1/models/pricing";
const OPENAPI_URL = "https://fal.ai/api/openapi/queue/openapi.json";

/**
 * fal answers 429 to fast sequential reads, so every loop paces itself and
 * every read backs off.
 *
 * The ladder is long because the limit is real and not gentle: a crawl of the
 * whole catalog earned a 429 on its eleventh pricing call at roughly seven
 * requests a second, and a short ladder just turns that into a failed crawl.
 */
const RETRY_BACKOFF_MS = [3_000, 6_000, 9_000, 15_000, 30_000, 60_000] as const;
const REQUEST_TIMEOUT_MS = 30_000;
/** Ids per pricing call. 20 is what the live API accepted. */
const PRICING_BATCH_SIZE = 20;
/** Schema reads are the long tail; a small ceiling keeps fal from rate-limiting. */
const SCHEMA_CONCURRENCY = 3;
/** Politeness gap between calls in the same loop. */
const REQUEST_SPACING_MS = 750;

/** fal refuses an anonymous-looking client on the fal.ai host. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; Sokosumi-Content-Studio/1.0; +https://sokosumi.com)";

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export interface FalModelRow {
  endpoint_id: string;
  metadata?: {
    display_name?: string;
    description?: string;
    category?: string;
    status?: string;
    model_url?: string;
    thumbnail_url?: string;
    tags?: string[];
    group?: { key?: string; label?: string };
    pinned?: boolean;
    highlighted?: boolean;
  };
}

export interface FalPriceRow {
  endpoint_id: string;
  unit_price: number;
  unit: string;
  currency?: string;
}

export interface FalCatalogSources {
  models: FalModelRow[];
  prices: Map<string, FalPriceRow>;
  /** Raw OpenAPI document per endpoint id that has one. */
  schemas: Map<string, unknown>;
  /**
   * Every endpoint fal lists under `image-to-image`.
   *
   * A separate source because a model's `/edit` variant is not in the
   * `text-to-image` category — `fal-ai/flux-2-pro` is, `fal-ai/flux-2-pro/edit`
   * is not. Looking for the edit endpoint inside the text-to-image list found
   * nothing and gave every single model `editEndpoint: null`, which silently
   * removed refinement from the whole studio.
   */
  editEndpoints: Set<string>;
  fetchedAt: string;
}

export interface CatalogExclusion {
  endpointId: string;
  /** One line, in the provider's own terms, for the log and the snapshot. */
  reason: string;
}

export interface NormalisedCatalog {
  models: ImageModel[];
  exclusions: CatalogExclusion[];
}

interface FetchOptions {
  fetchImpl: FetchLike;
  apiKey: string;
  /** Awaited between calls and between retries. Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (message: string) => void;
  /**
   * Checked between calls. False stops the crawl by throwing.
   *
   * A throw and not a partial return: a catalog missing models is worse than no
   * refresh at all, because adopting one would take working models out of the
   * composer until the next successful crawl.
   */
  shouldContinue?: () => boolean;
}

function requireBudget(options: FetchOptions): void {
  if (options.shouldContinue && !options.shouldContinue()) {
    throw new Error("the catalog crawl ran out of time before it finished");
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One read, retried only for the failures that are worth retrying.
 *
 * A 429 or a 5xx means "ask again"; a 4xx means the request is wrong and
 * repeating it just burns the rate limit that the 429 backoff is protecting.
 */
async function readJson(
  url: string,
  headers: Record<string, string>,
  options: FetchOptions,
): Promise<unknown> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError = "unknown";
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    requireBudget(options);
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS[attempt - 1]!);
    let response: Response;
    try {
      response = await options.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = `fal returned ${response.status}`;
      continue;
    }
    if (!response.ok) {
      throw new Error(`fal returned ${response.status} for ${url}`);
    }
    return await response.json();
  }
  throw new Error(`fal could not be read (${lastError}) for ${url}`);
}

function authHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Key ${apiKey}`, accept: "application/json" };
}

/** Every active endpoint in one category, following fal's cursor pagination. */
export async function fetchFalModels(
  options: FetchOptions,
  category = "text-to-image",
): Promise<FalModelRow[]> {
  const sleep = options.sleep ?? defaultSleep;
  const rows: FalModelRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(MODELS_URL);
    url.searchParams.set("category", category);
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const body = (await readJson(
      url.toString(),
      authHeaders(options.apiKey),
      options,
    )) as {
      models?: FalModelRow[];
      next_cursor?: string | null;
      has_more?: boolean;
    };
    for (const row of body.models ?? []) {
      if (typeof row?.endpoint_id === "string") rows.push(row);
    }
    options.onProgress?.(`${category}: ${rows.length} listed`);
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
    await sleep(REQUEST_SPACING_MS);
  }
  return rows;
}

/** Prices for many endpoints per call, keyed by endpoint id. */
export async function fetchFalPrices(
  endpointIds: string[],
  options: FetchOptions,
): Promise<Map<string, FalPriceRow>> {
  const sleep = options.sleep ?? defaultSleep;
  const prices = new Map<string, FalPriceRow>();
  for (let index = 0; index < endpointIds.length; index += PRICING_BATCH_SIZE) {
    const batch = endpointIds.slice(index, index + PRICING_BATCH_SIZE);
    const url = new URL(PRICING_URL);
    for (const id of batch) url.searchParams.append("endpoint_id", id);
    const body = (await readJson(
      url.toString(),
      authHeaders(options.apiKey),
      options,
    )) as { prices?: FalPriceRow[] };
    for (const row of body.prices ?? []) {
      if (typeof row?.endpoint_id === "string")
        prices.set(row.endpoint_id, row);
    }
    options.onProgress?.(`pricing: ${prices.size}/${endpointIds.length}`);
    await sleep(REQUEST_SPACING_MS);
  }
  return prices;
}

/**
 * One endpoint's OpenAPI document, or null when fal has none to give.
 *
 * Null is not a failure to retry: a handful of endpoints simply do not publish
 * a queue schema, and they are excluded rather than guessed at.
 */
export async function fetchFalSchema(
  endpointId: string,
  options: FetchOptions,
): Promise<unknown | null> {
  const url = `${OPENAPI_URL}?endpoint_id=${encodeURIComponent(endpointId)}`;
  try {
    return await readJson(
      url,
      { accept: "application/json", "user-agent": USER_AGENT },
      options,
    );
  } catch {
    return null;
  }
}

/**
 * Read every source, bounded.
 *
 * Schema reads run a few at a time rather than all at once: 200 simultaneous
 * requests is how the research run earned its first 429, and the backoff above
 * only helps if there is headroom left to back off into.
 */
export async function fetchFalCatalogSources(
  options: FetchOptions,
): Promise<FalCatalogSources> {
  const models = await fetchFalModels(options);
  const endpointIds = models.map((row) => row.endpoint_id);
  // The edit variants live in their own category, so refinement needs a second
  // listing. Cheap — two paged reads — and without it no model has an edit path.
  const editEndpoints = new Set(
    (await fetchFalModels(options, "image-to-image")).map(
      (row) => row.endpoint_id,
    ),
  );
  const prices = await fetchFalPrices(endpointIds, options);

  // Only endpoints that could become a row need a schema: a refine variant is
  // described by its base endpoint, and one without a price is already out.
  const schemaTargets = endpointIds.filter(
    (id) => !isRefineVariantEndpoint(id) && prices.has(id),
  );
  const schemas = new Map<string, unknown>();
  let done = 0;
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
    done += batch.length;
    options.onProgress?.(`schemas: ${done}/${schemaTargets.length}`);
    await (options.sleep ?? defaultSleep)(REQUEST_SPACING_MS);
  }

  return {
    models,
    prices,
    schemas,
    editEndpoints,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Endpoints whose whole purpose is to change an image they are handed.
 *
 * These are not excluded because they are useless — `/edit` is precisely how a
 * model offers refinement, and the normaliser attaches it to its base model.
 * They are excluded *as their own rows*, because the studio's generate path has
 * no image to give them.
 */
const REFINE_VARIANT_SUFFIXES = [
  "/edit",
  "/lora/edit",
  "/image-to-image",
  "/inpaint",
  "/inpainting",
  "/outpaint",
  "/redux",
  "/reframe",
  "/remix",
] as const;

export function isRefineVariantEndpoint(endpointId: string): boolean {
  return REFINE_VARIANT_SUFFIXES.some((suffix) => endpointId.endsWith(suffix));
}

/** Resolve one `$ref` hop inside an OpenAPI document. */
function deref(document: unknown, node: unknown): unknown {
  if (typeof node !== "object" || node === null) return node;
  const ref = (node as { $ref?: unknown }).$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return node;
  let current: unknown = document;
  for (const segment of ref.slice(2).split("/")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[
      segment.replace(/~1/g, "/").replace(/~0/g, "~")
    ];
  }
  return current;
}

/**
 * The request schema that carries this endpoint's capability facts.
 *
 * "The one with `prompt` in it" rather than "the one whose name ends in Input":
 * fal names these after the model, not after their role, and several documents
 * carry an output schema that would otherwise match on name alone.
 */
export function findPromptInputSchema(
  document: unknown,
): Record<string, unknown> | null {
  if (typeof document !== "object" || document === null) return null;
  const components = (document as { components?: unknown }).components;
  const schemas =
    typeof components === "object" && components !== null
      ? (components as { schemas?: unknown }).schemas
      : null;
  if (typeof schemas !== "object" || schemas === null) return null;
  let fallback: Record<string, unknown> | null = null;
  for (const [name, schema] of Object.entries(
    schemas as Record<string, unknown>,
  )) {
    if (typeof schema !== "object" || schema === null) continue;
    const properties = (schema as { properties?: unknown }).properties;
    if (typeof properties !== "object" || properties === null) continue;
    if (!("prompt" in (properties as Record<string, unknown>))) continue;
    if (name.endsWith("Input")) return schema as Record<string, unknown>;
    fallback ??= schema as Record<string, unknown>;
  }
  return fallback;
}

/** Enum values a property offers, looking through `anyOf`/`oneOf` and `$ref`. */
function enumValues(document: unknown, property: unknown): string[] {
  const node = deref(document, property);
  if (typeof node !== "object" || node === null) return [];
  const direct = (node as { enum?: unknown }).enum;
  if (Array.isArray(direct)) {
    return direct.filter((value): value is string => typeof value === "string");
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = (node as Record<string, unknown>)[key];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      const values = enumValues(document, branch);
      if (values.length > 0) return values;
    }
  }
  return [];
}

/** True when a property can be given explicit `{ width, height }`. */
function acceptsExplicitDimensions(
  document: unknown,
  property: unknown,
): boolean {
  const node = deref(document, property);
  if (typeof node !== "object" || node === null) return false;
  const properties = (node as { properties?: unknown }).properties;
  if (
    typeof properties === "object" &&
    properties !== null &&
    "width" in (properties as Record<string, unknown>) &&
    "height" in (properties as Record<string, unknown>)
  ) {
    return true;
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = (node as Record<string, unknown>)[key];
    if (!Array.isArray(branches)) continue;
    if (branches.some((branch) => acceptsExplicitDimensions(document, branch)))
      return true;
  }
  return false;
}

/** Fields fal insists on. An image among them means there is nothing to send. */
const REQUIRED_IMAGE_FIELDS = [
  "image_url",
  "image_urls",
  "image",
  "images",
] as const;

function slugFromEndpoint(endpointId: string): string {
  return endpointId
    .replace(/^fal-ai\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .toLowerCase();
}

function studioSubset(
  offered: string[],
  vocabulary: readonly string[],
): string[] {
  return vocabulary.filter((value) => offered.includes(value));
}

function normaliseUnit(unit: string): ImagePriceUnit | string {
  const match = IMAGE_PRICE_UNITS.find(
    (known) => known === unit.trim().toLowerCase(),
  );
  return match ?? unit.trim().toLowerCase();
}

/**
 * Turn fal's three payloads into studio catalog rows.
 *
 * The studio's own vocabulary is the ceiling, not fal's: a model offering
 * thirty aspect ratios is exposed as the nine the studio has controls and
 * dimension maths for, because a ratio the composer cannot express and the
 * price cannot be computed for is not a capability the studio has.
 *
 * Nothing is invented here. A fact fal does not publish becomes an exclusion
 * with a reason, never a default that looks like knowledge.
 */
export function normaliseFalCatalog(
  sources: FalCatalogSources,
): NormalisedCatalog {
  const verifiedAt = sources.fetchedAt.slice(0, 10);
  const models: ImageModel[] = [];
  const exclusions: CatalogExclusion[] = [];
  const takenIds = new Set<string>();

  for (const row of sources.models) {
    const endpointId = row.endpoint_id;

    if (isRefineVariantEndpoint(endpointId)) {
      exclusions.push({
        endpointId,
        reason:
          "Refine variant: it changes an image it is handed, so it is offered as its base model's edit endpoint rather than as its own row.",
      });
      continue;
    }

    const price = sources.prices.get(endpointId);
    if (!price || typeof price.unit_price !== "number") {
      exclusions.push({
        endpointId,
        reason: "fal published no price for this endpoint.",
      });
      continue;
    }

    const document = sources.schemas.get(endpointId);
    if (document === undefined) {
      exclusions.push({
        endpointId,
        reason: "fal published no queue schema, so its inputs are unknown.",
      });
      continue;
    }

    const input = findPromptInputSchema(document);
    if (!input) {
      exclusions.push({
        endpointId,
        reason:
          "No input schema takes a prompt, so the composer has nothing to drive it with.",
      });
      continue;
    }

    const properties = (input.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(input.required)
      ? input.required.filter(
          (name): name is string => typeof name === "string",
        )
      : [];
    const requiredImage = REQUIRED_IMAGE_FIELDS.find((field) =>
      required.includes(field),
    );
    if (requiredImage) {
      exclusions.push({
        endpointId,
        reason: `Requires \`${requiredImage}\`: an input image is mandatory and the studio's generate path has none.`,
      });
      continue;
    }

    const aspectRatios = studioSubset(
      enumValues(document, properties.aspect_ratio),
      IMAGE_ASPECT_RATIOS,
    );
    const explicitDimensions =
      "image_size" in properties &&
      acceptsExplicitDimensions(document, properties.image_size);

    let dimensionMode: ImageModel["dimensionMode"];
    let resolutions: string[];
    let frameRatios: readonly string[];
    if (aspectRatios.length > 0) {
      dimensionMode = "aspect-ratio";
      frameRatios = aspectRatios;
      const offered = studioSubset(
        enumValues(document, properties.resolution),
        IMAGE_RESOLUTIONS,
      );
      // No resolution control means the model picks its own pixel count. The
      // studio still needs one tier to price and to store, and 1K is the tier
      // whose dimensions match what these models actually return.
      resolutions = offered.length > 0 ? offered : ["1K"];
    } else if (explicitDimensions) {
      dimensionMode = "image-size";
      frameRatios = IMAGE_ASPECT_RATIOS;
      resolutions = ["1K", "2K"];
    } else {
      exclusions.push({
        endpointId,
        reason:
          "Neither an `aspect_ratio` the studio offers nor an `image_size` taking explicit dimensions, so the frame cannot be controlled.",
      });
      continue;
    }

    const outputFormats = studioSubset(
      enumValues(document, properties.output_format),
      IMAGE_OUTPUT_FORMATS,
    );

    // fal lists the refine variant under `image-to-image`, never beside its base
    // model, so this reads the second listing rather than the one being walked.
    const editEndpoint = sources.editEndpoints.has(`${endpointId}/edit`)
      ? `${endpointId}/edit`
      : null;

    const providerFields = IMAGE_PROVIDER_FIELDS.filter(
      (field): field is ImageProviderField => {
        if (field === "image_size") return dimensionMode === "image-size";
        if (field === "aspect_ratio") return dimensionMode === "aspect-ratio";
        if (field === "resolution") {
          return dimensionMode === "aspect-ratio" && "resolution" in properties;
        }
        if (field === "output_format") return outputFormats.length > 0;
        if (field === "image_urls") return editEndpoint !== null;
        return field in properties;
      },
    );

    // A slug, not the endpoint: it is the id a saved job carries for ever, so
    // it has to be short, stable, and free of the punctuation a URL path has.
    let id = slugFromEndpoint(endpointId);
    if (takenIds.has(id)) id = slugFromEndpoint(endpointId.replace("/", "-"));
    if (takenIds.has(id)) {
      exclusions.push({
        endpointId,
        reason: `Slug \`${id}\` is already taken by another endpoint.`,
      });
      continue;
    }
    takenIds.add(id);

    const unit = normaliseUnit(price.unit);
    const label = row.metadata?.display_name?.trim() || id;
    const modelUrl =
      row.metadata?.model_url ?? `https://fal.ai/models/${endpointId}`;

    models.push({
      id,
      label,
      description: oneLine(row.metadata?.description ?? ""),
      generateEndpoint: endpointId,
      editEndpoint,
      aspectRatios: frameRatios,
      resolutions,
      outputFormats,
      supportsSeed: providerFields.includes("seed"),
      maxReferences: editEndpoint ? 4 : 0,
      dimensionMode,
      providerFields,
      curatedRank: null,
      notes: editEndpoint
        ? "Capabilities read from fal's own queue schema. Refinement uses this model's /edit endpoint."
        : "Capabilities read from fal's own queue schema. fal lists no /edit endpoint, so this model generates but cannot refine.",
      price: {
        unit,
        unitPriceUsd: price.unit_price,
        basis: `fal lists $${price.unit_price} per ${unit} for this endpoint.`,
        sourceUrl: `https://fal.ai/models/${endpointId}`,
        verifiedAt,
      },
      sourceUrls: [modelUrl],
      verifiedAt,
    });
  }

  return { models, exclusions };
}

/**
 * Drop rows whose price cannot be turned into a per-image charge.
 *
 * Kept separate from the normaliser and run *after* overrides, because an
 * override supplying `perImageUsd` is exactly how a human rescues a model fal
 * prices by compute second. Excluding it before the override is applied would
 * throw away the one thing that made it chargeable.
 *
 * Two distinct grounds, both measured rather than assumed. A unit that does not
 * describe one image — 34 models at the 2026-09-27 snapshot. And an area-priced
 * unit on a model whose output *size the provider picks*, which the studio can
 * only guess at: three models, found on preview when `fal-ai/nucleus-image` at
 * 16:9 1K was charged 1 credit for an image fal billed 2 cents for.
 */
export function excludeUnpriceableModels(models: ImageModel[]): {
  models: ImageModel[];
  exclusions: CatalogExclusion[];
} {
  const kept: ImageModel[] = [];
  const exclusions: CatalogExclusion[] = [];
  for (const model of models) {
    if (!isUnchargeableModel(model)) {
      kept.push(model);
      continue;
    }
    exclusions.push({
      endpointId: model.generateEndpoint,
      reason: unchargeableReason(model),
    });
  }
  return { models: kept, exclusions };
}
