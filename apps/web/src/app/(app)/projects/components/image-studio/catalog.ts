import type {
  StudioAsset,
  StudioCatalog,
  StudioJob,
  StudioModel,
  StudioPlacement,
  StudioSettings,
} from "./types";

/**
 * Reading the catalog Core sends, and nothing else.
 *
 * Every model name, aspect ratio, resolution and placement the studio offers
 * comes from `state.catalog`. Nothing in this file contains a fal endpoint, a
 * platform dimension or a model id of its own: an endpoint the catalog does
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

export function placementById(
  catalog: StudioCatalog,
  id: string | null | undefined,
): StudioPlacement | null {
  if (!id) return null;
  return catalog.placements.find((placement) => placement.id === id) ?? null;
}

/**
 * A placement's name, including the platform it belongs to.
 *
 * The catalog labels Instagram's and Facebook's Reels placements identically
 * ("Reels image concept") and distinguishes them only by `platform`, so the
 * label alone renders two chips nobody can tell apart.
 */
export function placementName(placement: StudioPlacement): string {
  return `${placement.platform} · ${placement.label}`;
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
 * Whether a model can honour a placement's aspect ratio.
 *
 * A placement is a recommendation about framing, so a model that cannot frame
 * that way cannot serve it. Offering the chip anyway and quietly generating
 * 1:1 for a 9:16 Reels concept is exactly the "unsupported combination"
 * the brief rules out.
 */
export function modelSupportsPlacement(
  model: StudioModel,
  placement: StudioPlacement,
): boolean {
  return model.aspectRatios.includes(placement.aspectRatio);
}

/**
 * Apply a placement to settings, or clear it.
 *
 * The placement drives the aspect ratio and nothing else. Resolution stays a
 * model setting, because the studio generates up to 2K and a placement's
 * pixel target is the platform's advice about the finished asset, not a size
 * this studio promises to output.
 */
export function applyPlacement(
  settings: StudioSettings,
  placement: StudioPlacement | null,
): StudioSettings {
  if (!placement) {
    const { placementId: _dropped, ...rest } = settings;
    return { ...rest, placementId: null };
  }
  return {
    ...settings,
    placementId: placement.id,
    aspectRatio: placement.aspectRatio as StudioSettings["aspectRatio"],
  };
}

/**
 * The settings a follow-up generation inherits.
 *
 * Read from the asset or job being acted on, never from a default and never
 * from whatever happens to be selected. A landscape 2K Reels original that
 * regenerates as a square 1K with no placement reads as the product ignoring
 * the request, and `placementId` is in here precisely so it survives.
 */
export function settingsOf(
  source: StudioAsset | StudioJob | null,
): StudioSettings {
  return {
    aspectRatio: source?.settings?.aspectRatio ?? "1:1",
    resolution: source?.settings?.resolution ?? "1K",
    outputFormat: source?.settings?.outputFormat ?? "png",
    seed: source?.settings?.seed ?? null,
    placementId: source?.settings?.placementId ?? null,
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
