import {
  creditsPerImageCents,
  type ImagePriceFigures,
  imageOutputDimensions,
  isAreaPricedUnit,
} from "@sokosumi/utils";

/**
 * What a studio image model *is*: its vocabulary, its shape, and the rules that
 * hold for one model in isolation.
 *
 * Separate from {@link ./catalog}, which answers "which models exist". That
 * module holds the resolved catalog and therefore the committed snapshot; this
 * one holds nothing but declarations and pure functions, so the fetcher and the
 * override layer can describe a model without pulling a two-hundred-row snapshot
 * — and without the import cycle that would create.
 */

/** Frames the studio has controls and dimension maths for. */
export const IMAGE_ASPECT_RATIOS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
  "4:5",
  "5:4",
] as const;

/** Output size tiers the studio offers, whatever a provider calls them. */
export const IMAGE_RESOLUTIONS = ["0.5K", "1K", "2K"] as const;

export const IMAGE_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;

/**
 * Provider input properties the studio knows how to set.
 *
 * A model row lists the subset its own fal schema declares, and `buildFalInput`
 * sends only those. Sending a field an endpoint does not declare is how a
 * perfectly good generation comes back as a 422 — `num_images` and
 * `limit_generations` are Gemini's, not everyone's.
 */
export const IMAGE_PROVIDER_FIELDS = [
  "aspect_ratio",
  "resolution",
  "image_size",
  "output_format",
  "num_images",
  "seed",
  "limit_generations",
  "image_urls",
] as const;

export type ImageProviderField = (typeof IMAGE_PROVIDER_FIELDS)[number];

export const DEFAULT_IMAGE_MODEL_ID = "gemini-flash";

/**
 * What one image costs, in the provider's own terms.
 *
 * `unit` and `unitPriceUsd` are fal's figures, verbatim from its pricing
 * endpoint. `perImageUsd` is the hand-verified exception: fal lists Gemini at
 * "$0.08 per image" and then multiplies that by 0.75 at 512px and 1.5 at 2K,
 * which the unit alone cannot say. `creditsPerImageCents` prefers it wherever a
 * person has written it down.
 *
 * `basis` is meant to be shown. A figure about money that a person cannot
 * interrogate is worse than no figure at all.
 */
export interface ImagePrice extends ImagePriceFigures {
  /** USD per image by studio resolution tier. Hand-verified where present. */
  perImageUsd?: Partial<Record<(typeof IMAGE_RESOLUTIONS)[number], number>>;
  /** How the figure was arrived at, in the provider's own terms. */
  basis: string;
  sourceUrl: string;
  verifiedAt: string;
}

export interface ImageModel {
  id: string;
  label: string;
  description: string;
  generateEndpoint: string;
  /**
   * Null when fal lists no `/edit` variant for this model.
   *
   * Nullable rather than absent, and every reader has to mean it: a model with
   * no edit endpoint offers no refinement, no references, and no variation from
   * a selection. `maxReferences` is 0 for exactly these models, which is what
   * makes {@link validateImageSettings} refuse a reference before anything is
   * reserved or sent.
   */
  editEndpoint: string | null;
  aspectRatios: readonly string[];
  resolutions: readonly string[];
  /** Empty means the model chooses; the studio then sends no format at all. */
  outputFormats: readonly string[];
  supportsSeed: boolean;
  maxReferences: number;
  dimensionMode: "aspect-ratio" | "image-size";
  /** The provider input properties this endpoint actually declares. */
  providerFields: readonly ImageProviderField[];
  /** 1-5 for the curated shortlist, in order. Null for everything else. */
  curatedRank: number | null;
  notes: string;
  /** The provider's list price. Never a charge; see {@link ImagePrice}. */
  price: ImagePrice;
  sourceUrls: string[];
  verifiedAt: string;
}

export interface ImageSettings {
  aspectRatio: string;
  resolution: string;
  outputFormat: string;
  seed: number | null;
}

/**
 * Check settings against one model and return the settings it will be sent.
 *
 * Deliberately a throw and not a boolean: every caller is about to reserve a row
 * or spend money, and the message is what the person reads.
 */
export function validateImageSettings(
  model: ImageModel,
  settings: ImageSettings,
  referenceCount: number,
): ImageSettings {
  const resolved: ImageSettings = {
    aspectRatio: settings.aspectRatio,
    resolution: settings.resolution,
    outputFormat: settings.outputFormat,
    seed: settings.seed,
  };
  if (!model.aspectRatios.includes(resolved.aspectRatio))
    throw new Error(`${model.label} does not support this aspect ratio.`);
  if (!model.resolutions.includes(resolved.resolution))
    throw new Error(`${model.label} does not support this resolution.`);
  // An empty list means fal's schema declares no format field, so the model
  // chooses, the studio sends nothing, and there is nothing to reject.
  if (
    model.outputFormats.length > 0 &&
    !model.outputFormats.includes(resolved.outputFormat)
  )
    throw new Error(`${model.label} does not support this output format.`);
  if (referenceCount > 0 && model.editEndpoint === null)
    throw new Error(
      `${model.label} cannot refine an existing image: fal lists no edit endpoint for it.`,
    );
  if (referenceCount > model.maxReferences)
    throw new Error(
      `${model.label} supports at most ${model.maxReferences} references in Studio.`,
    );
  if (resolved.seed !== null && !model.supportsSeed)
    throw new Error(`${model.label} does not accept a seed.`);
  if (
    resolved.seed !== null &&
    (!Number.isInteger(resolved.seed) ||
      resolved.seed < 0 ||
      resolved.seed > 2_147_483_647)
  )
    throw new Error("Seed must be an integer between 0 and 2147483647.");
  return resolved;
}

/**
 * What one image on these settings costs in credits, where 1 credit = 1 cent.
 *
 * The one figure the studio charges and the one figure it shows. Both the
 * composer's pre-flight estimate and `reserveJobTransaction`'s debit come from
 * here — through `@sokosumi/utils`, so the browser runs the identical formula —
 * because an estimate that disagrees with the debit is a promise the ledger then
 * quietly breaks.
 *
 * Throws rather than returning zero for a model whose price is not derivable per
 * image. Such a model is kept out of the catalog, so reaching this is a bug, and
 * a silently free generation is the one wrong answer nobody notices.
 */
export function creditsPerImage(
  model: ImageModel,
  settings: Pick<ImageSettings, "aspectRatio" | "resolution">,
): number {
  const cents = creditsPerImageCents(model.price, {
    aspectRatio: settings.aspectRatio,
    resolution: settings.resolution,
    providerChoosesSize: providerChoosesOutputSize(model),
  });
  if (cents === null) {
    throw new Error(
      `${model.label} has no per-image price at ${settings.resolution}, so it cannot be charged for.`,
    );
  }
  return cents;
}

/**
 * True when the provider, not the studio, decides the output pixel count.
 *
 * The studio only sends exact dimensions in `image-size` mode. In `aspect-ratio`
 * mode it asks for a shape and the provider returns whatever size it likes, so an
 * area the studio computes for such a model is a guess — fine for laying out a
 * preview, not fine for billing. See `providerChoosesSize` in `@sokosumi/utils`.
 */
export function providerChoosesOutputSize(model: ImageModel): boolean {
  return model.dimensionMode !== "image-size";
}

/**
 * True when this model's price cannot be turned into a per-image charge.
 *
 * Two ways that happens: a unit that does not describe one image (compute seconds
 * and friends), and an area-priced unit on a model whose output size the provider
 * picks. Either way the model is held out of the catalog unless an override
 * supplies a hand-verified `perImageUsd`.
 */
export function isUnchargeableModel(model: ImageModel): boolean {
  if (model.resolutions.length === 0) return true;
  return model.resolutions.some(
    (resolution) =>
      creditsPerImageCents(model.price, {
        aspectRatio: model.aspectRatios[0] ?? "1:1",
        resolution,
        providerChoosesSize: providerChoosesOutputSize(model),
      }) === null,
  );
}

/** Why {@link isUnchargeableModel} said so, for the exclusion record. */
export function unchargeableReason(model: ImageModel): string {
  if (isAreaPricedUnit(model.price.unit) && providerChoosesOutputSize(model)) {
    return `Priced by ${model.price.unit} while the provider picks the output size, so the area fal bills is not the area the studio asked for, and no override supplies a per-image figure.`;
  }
  return `Priced by ${model.price.unit}, which does not describe one image, and no override supplies a per-image figure.`;
}

/**
 * Pixel dimensions for a frame, for models that take explicit dimensions.
 *
 * Shared with the browser through `@sokosumi/utils` for the same reason the
 * credits formula is: the area it returns is what an area-priced model is billed
 * on, so two implementations would be two different prices.
 */
export function imageDimensions(
  aspectRatio: string,
  resolution: string,
): { width: number; height: number } {
  return imageOutputDimensions(aspectRatio, resolution);
}
