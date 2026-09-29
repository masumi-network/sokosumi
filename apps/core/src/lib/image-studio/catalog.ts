import { applyCatalogOverrides } from "./catalog-overrides";
import { excludeUnpriceableModels } from "./fal-catalog-fetch";
import snapshot from "./fal-catalog-snapshot.json";
import {
  DEFAULT_IMAGE_MODEL_ID,
  type ImageModel,
  type ImageSettings,
  validateImageSettings,
} from "./image-model";

/**
 * Which image models the studio has, and who gets to say so.
 *
 * Core is the single source of truth for every capability and every price. The
 * browser never learns either from anywhere else, because a client holding its
 * own copy is a second, unverified authority on what the provider does and on
 * what the person will be charged.
 *
 * Where the facts come from, in order of precedence:
 *
 * 1. {@link ./catalog-overrides} — the hand-verified layer, and the only place a
 *    human figure lives.
 * 2. fal's own API, normalised by {@link ./fal-catalog-fetch} and refreshed by
 *    {@link ./fal-catalog-refresh}.
 * 3. `fal-catalog-snapshot.json` — a committed capture of (2), so a cold start
 *    has the whole catalog with no network call and the studio is never empty.
 *
 * **Reads are synchronous on purpose.** `imageModel`, `imageModelForEndpoint` and
 * `resolveImageSettings` are called while building a provider payload and from
 * inside a reservation transaction. Making them async would put an await — and
 * therefore a possible provider fetch — in the middle of the one place nothing
 * may block, and would push `async` through the Zod schemas that quote the
 * studio vocabulary. Instead the resolved catalog is module state seeded from the
 * committed snapshot, and refreshing it is an explicit, detached step:
 * `ensureImageCatalogFresh()`. A refresh failure leaves the last good catalog in
 * place and never empties the studio.
 */

interface CatalogSnapshotFile {
  generatedAt: string;
  models: unknown[];
}

export interface ImageCatalog {
  defaultModelId: string;
  /** Curated shortlist first, in rank order, then everything else by label. */
  models: ImageModel[];
  /** The date the committed snapshot behind this catalog was captured. */
  snapshotDate: string;
  /** When the live catalog was last refreshed, or null on a cold start. */
  refreshedAt: string | null;
}

/**
 * Order the rows once, here, so no client holds its own shortlist.
 *
 * The curated five are editorial and their order is the product decision; the
 * rest are alphabetical, because any other order would be an opinion this
 * catalog has not earned.
 */
function sortModels(models: ImageModel[]): ImageModel[] {
  return [...models].sort((left, right) => {
    const leftRank = left.curatedRank ?? Number.POSITIVE_INFINITY;
    const rightRank = right.curatedRank ?? Number.POSITIVE_INFINITY;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.label.localeCompare(right.label);
  });
}

/** Overrides, then the price filter, then one stable order. */
export function resolveCatalogModels(fetched: ImageModel[]): ImageModel[] {
  const { models } = excludeUnpriceableModels(applyCatalogOverrides(fetched));
  return sortModels(models);
}

const SNAPSHOT = snapshot as CatalogSnapshotFile;

/**
 * The catalog every synchronous reader sees.
 *
 * Seeded from the committed snapshot at import, so the first request to a cold
 * instance is answered in full with no provider call at all.
 */
let resolvedModels: ImageModel[] = resolveCatalogModels(
  SNAPSHOT.models as ImageModel[],
);
let refreshedAt: string | null = null;

/**
 * Replace the resolved catalog. Only {@link ./fal-catalog-refresh} calls this.
 *
 * Refuses an empty list rather than accepting it: an empty catalog is a studio
 * with no models, and the whole point of the snapshot is that this cannot
 * happen. A refresh that produced nothing is a broken refresh, not new news.
 */
export function setResolvedImageCatalog(
  fetched: ImageModel[],
  fetchedAt: string,
): boolean {
  const models = resolveCatalogModels(fetched);
  if (models.length === 0) return false;
  resolvedModels = models;
  refreshedAt = fetchedAt;
  return true;
}

/** The one accessor. Everything else in the studio reads through this. */
export function getImageCatalog(): ImageCatalog {
  return {
    defaultModelId: defaultModelId(),
    models: resolvedModels,
    snapshotDate: SNAPSHOT.generatedAt,
    refreshedAt,
  };
}

/**
 * The model a request with no `modelId` gets.
 *
 * Falls through rather than throwing: if fal ever withdraws the studio's default,
 * the composer should open on the next curated model rather than fail to open.
 */
function defaultModelId(): string {
  const preferred = resolvedModels.find(
    (model) => model.id === DEFAULT_IMAGE_MODEL_ID,
  );
  if (preferred) return preferred.id;
  return resolvedModels[0]?.id ?? DEFAULT_IMAGE_MODEL_ID;
}

export function imageModel(id?: string): ImageModel {
  const wanted = id ?? defaultModelId();
  const model = resolvedModels.find((candidate) => candidate.id === wanted);
  if (!model)
    throw new Error(
      "Unsupported image model. Choose a model from the studio catalog.",
    );
  return model;
}

/**
 * The model behind an endpoint, or null when the catalog no longer lists it.
 *
 * Null rather than a throw, because a stored job keeps its endpoint for ever and
 * the catalog is now live: a model fal withdraws must still be nameable in
 * history, and a read path that threw would take the whole feed down with it.
 */
export function findImageModelForEndpoint(endpoint: string): ImageModel | null {
  return (
    resolvedModels.find(
      (candidate) =>
        candidate.generateEndpoint === endpoint ||
        candidate.editEndpoint === endpoint,
    ) ?? null
  );
}

/** The submission path's lookup: an unknown endpoint here is a bug, not news. */
export function imageModelForEndpoint(endpoint: string): ImageModel {
  const model = findImageModelForEndpoint(endpoint);
  if (!model) throw new Error("Unsupported image model endpoint.");
  return model;
}

/** Used before reservation by both browser and agent calls. */
export function resolveImageSettings(
  modelId: string | undefined,
  settings: ImageSettings,
  referenceCount: number,
): ImageSettings {
  return validateImageSettings(imageModel(modelId), settings, referenceCount);
}
