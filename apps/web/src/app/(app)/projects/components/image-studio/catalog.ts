import { creditsPerImageCents } from "@sokosumi/utils";

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
 * The models the studio opens with.
 *
 * Core's `curatedRank` names a shortlist of five hand-picked for range rather
 * than for price — a general image model, a stronger one, a photographic one,
 * one that handles typography, and one for vector and brand work. One brief
 * across all five is the thing this composer is for, so it is what a person
 * lands on rather than something they have to assemble first.
 *
 * Read off the catalog and sorted by the rank Core gave, never held here: a
 * shortlist copied into the browser is a second opinion about which models are
 * good, and it would go stale the moment fal withdrew one of them. `models`
 * already arrives curated-first, but this does not rely on that either.
 *
 * Falls back to the catalog's own default when no row is ranked, so a catalog
 * without a shortlist still opens on something rather than on nothing.
 */
export function curatedModels(catalog: StudioCatalog): StudioModel[] {
  const ranked = catalog.models
    .filter((model) => model.curatedRank !== null)
    .sort((a, b) => (a.curatedRank ?? 0) - (b.curatedRank ?? 0));
  if (ranked.length > 0) return ranked;
  const fallback = defaultModel(catalog);
  return fallback ? [fallback] : [];
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
  // An empty `outputFormats` is Core saying the model chooses its own format,
  // so this lands on `undefined` and the request carries no format at all.
  // Picking one anyway is a 422 on a generation that would have worked.
  const outputFormat =
    settings.outputFormat && model.outputFormats.includes(settings.outputFormat)
      ? settings.outputFormat
      : (model.outputFormats[0] as StudioSettings["outputFormat"] | undefined);

  return {
    ...settings,
    aspectRatio,
    resolution,
    outputFormat,
    ...(model.supportsSeed ? {} : { seed: null }),
  };
}

/**
 * fal's pricing unit, as one thing rather than as a plural.
 *
 * fal's pricing API answers in plurals — `images`, `megapixels` — because it is
 * describing a rate, and Core passes that through verbatim in `price.basis`.
 * Dropped into a sentence about *one* of them it reads "per images", which is
 * the sentence the preview showed for every per-image model.
 *
 * Returns the label key for the units a catalog model can actually carry, and
 * `null` for anything else so the caller falls back to fal's own word. Only
 * per-image and per-megapixel units reach the catalog — Core excludes the rest,
 * because they cannot be priced per image — so the other four are the fallback
 * by design rather than by omission.
 */
export function priceUnitLabelKey(unit: string): string | null {
  switch (unit) {
    case "images":
      return "images";
    case "generations":
      return "generations";
    case "megapixels":
      return "megapixels";
    case "processed megapixels":
      return "processedMegapixels";
    default:
      return null;
  }
}

/**
 * What one image from this model, at this frame, will be debited.
 *
 * `creditsPerImageCents` comes from `@sokosumi/utils` and is **the same
 * function Core charges with**, over the same catalog row. That is the whole
 * reason it is shared rather than reimplemented here: two implementations of
 * this formula would be a number shown to the person that the ledger then
 * quietly contradicts. 1 credit = 1 cent, and there is no markup on fal's
 * published price.
 *
 * `null` rather than a guess. It should not happen for a catalog model — Core
 * excludes the models it cannot price per image — but a caller that gets `null`
 * has to say the figure is unknown rather than render `NaN`.
 */
export function creditsForImage(
  model: StudioModel,
  settings: StudioSettings,
): number | null {
  const { aspectRatio, resolution } = settings;
  if (!aspectRatio || !resolution) return null;
  return creditsPerImageCents(model.price, { aspectRatio, resolution });
}

/**
 * What a batch will be debited, or `null` if any leg cannot be priced.
 *
 * All-or-nothing on purpose. A total that quietly left out the one model with
 * no derivable figure would still read as the price of the whole batch, which
 * is the one way an estimate can be worse than no estimate.
 */
export function creditsForBatch(
  legs: readonly { model: StudioModel; settings: StudioSettings }[],
): number | null {
  let total = 0;
  for (const leg of legs) {
    const credits = creditsForImage(leg.model, leg.settings);
    if (credits === null) return null;
    total += credits;
  }
  return total;
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
