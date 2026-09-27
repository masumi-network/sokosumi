import type {
  StudioAsset,
  StudioCatalog,
  StudioJob,
  StudioModel,
  StudioSettings,
} from "./types";

/**
 * Reading the catalog Core sends, and nothing else.
 *
 * Every model name, aspect ratio and resolution the studio offers comes from
 * `state.catalog`. Nothing in this file contains a fal endpoint or a model id
 * of its own: an endpoint the catalog does
 * not list is reported as itself rather than guessed at, and a combination the
 * catalog does not list is not offered. That is the whole point of the shared
 * capability catalog — the UI must not be a second, unverified source of what
 * the provider supports.
 */

/** What a finished image says about how it was made. */
export interface ResolvedModel {
  /** Catalog id, or `null` when the endpoint predates the catalog. */
  id: string | null;
  /** Catalog label, or the raw endpoint when there is nothing better. */
  label: string;
  /** True when the endpoint was matched, so callers can style the difference. */
  known: boolean;
}

/**
 * Which catalog model an endpoint belongs to.
 *
 * Jobs and assets persist the endpoint that actually ran, not a catalog id,
 * because the endpoint is the reproducible fact. Both of a model's endpoints
 * map to it, so an EDIT and a GENERATE from the same model read as one model.
 *
 * Unmatched endpoints are shown verbatim. Images generated before the catalog
 * existed are real work someone did; labelling them "Unknown model" would lose
 * information the row already has.
 */
export function resolveModel(
  catalog: StudioCatalog,
  endpoint: string | null | undefined,
): ResolvedModel {
  if (!endpoint) return { id: null, label: "", known: false };
  const match = catalog.models.find(
    (model) =>
      model.generateEndpoint === endpoint || model.editEndpoint === endpoint,
  );
  return match
    ? { id: match.id, label: match.label, known: true }
    : { id: null, label: endpoint, known: false };
}

export function modelById(
  catalog: StudioCatalog,
  id: string | null | undefined,
): StudioModel | null {
  if (!id) return null;
  return catalog.models.find((model) => model.id === id) ?? null;
}

/**
 * The model to start from.
 *
 * `defaultModelId` is what Core would pick anyway, so honouring it keeps the
 * composer's preview and the job that is actually created in agreement. The
 * first listed model is the fallback for a catalog whose default was withdrawn.
 */
export function defaultModel(catalog: StudioCatalog): StudioModel | null {
  return (
    modelById(catalog, catalog.defaultModelId) ?? catalog.models[0] ?? null
  );
}

/**
 * Settings a model can actually run, given what the person asked for.
 *
 * Switching model is the case this exists for: FLUX has no 0.5K, so moving a
 * 0.5K draft onto FLUX has to land somewhere. It lands on the nearest offer
 * the model does make rather than on a value Core would reject after the
 * person has already pressed Generate.
 */
export function clampToModel(
  model: StudioModel,
  settings: StudioSettings,
): StudioSettings {
  const aspectRatio =
    settings.aspectRatio && model.aspectRatios.includes(settings.aspectRatio)
      ? settings.aspectRatio
      : (model.aspectRatios[0] as StudioSettings["aspectRatio"]);
  const resolution =
    settings.resolution && model.resolutions.includes(settings.resolution)
      ? settings.resolution
      : (model.resolutions[0] as StudioSettings["resolution"]);
  const outputFormat =
    settings.outputFormat && model.outputFormats.includes(settings.outputFormat)
      ? settings.outputFormat
      : (model.outputFormats[0] as StudioSettings["outputFormat"]);

  return {
    ...settings,
    aspectRatio,
    resolution,
    outputFormat,
    ...(model.supportsSeed ? {} : { seed: null }),
  };
}

/**
 * The provider's list price for one image from this model at this resolution.
 *
 * `null` rather than a guess. There is deliberately no fallback to another
 * tier's figure: a plausible wrong number about money is worse than an absent
 * one, so a caller that gets `null` has to say the price is unknown.
 */
export function priceForImage(
  model: StudioModel,
  resolution: StudioSettings["resolution"] | null | undefined,
): number | null {
  if (!resolution) return null;
  return model.price.perImageUsd[resolution] ?? null;
}

/**
 * What a batch would cost at list price, or `null` if any leg is unpriced.
 *
 * All-or-nothing on purpose. A total that quietly left out the one model with
 * no published figure would still read as the price of the whole batch, which
 * is the one way an estimate can be worse than no estimate.
 */
export function estimateBatchUsd(
  legs: readonly { model: StudioModel; settings: StudioSettings }[],
): number | null {
  let total = 0;
  for (const leg of legs) {
    const price = priceForImage(leg.model, leg.settings.resolution);
    if (price === null) return null;
    total += price;
  }
  return total;
}

/**
 * Money, to the cent.
 *
 * Not `Intl.NumberFormat`: these are US dollars because fal bills in US
 * dollars, and localising the symbol would imply the amount had been
 * converted. Two places always, so $0.90 does not render as $0.9.
 */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * The settings a follow-up generation inherits.
 *
 * Read from the asset or job being acted on, never from a default and never
 * from whatever happens to be selected. A landscape 2K original that
 * regenerates as a square 1K reads as the product ignoring the request.
 */
export function settingsOf(
  source: StudioAsset | StudioJob | null,
): StudioSettings {
  return {
    aspectRatio: source?.settings?.aspectRatio ?? "1:1",
    resolution: source?.settings?.resolution ?? "1K",
    outputFormat: source?.settings?.outputFormat ?? "png",
    seed: source?.settings?.seed ?? null,
  };
}

/**
 * The model id to reuse when repeating a piece of work.
 *
 * Falls back to the catalog default when the original endpoint is not in the
 * catalog: a retry has to name *some* model, and the alternative is refusing
 * to retry work that predates the catalog.
 */
export function modelIdForRepeat(
  catalog: StudioCatalog,
  endpoint: string | null | undefined,
): string | null {
  return (
    resolveModel(catalog, endpoint).id ?? defaultModel(catalog)?.id ?? null
  );
}
