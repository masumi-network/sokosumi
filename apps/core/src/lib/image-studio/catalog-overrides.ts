import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_RESOLUTIONS,
  type ImageModel,
} from "./image-model";

/**
 * The hand-verified layer, and the only place in the studio a human figure
 * lives.
 *
 * Everything else about a model comes from fal's own API. What cannot come from
 * there is exactly this: a price whose unit does not describe one image, a tier
 * multiplier fal documents in prose rather than through its pricing endpoint,
 * and the editorial judgement of which five models a person is offered first.
 * Keeping those in one file means a reviewer can see every number the studio
 * asserts on its own authority by reading one screen.
 *
 * Matched on `endpoint`, not on id. The generated id is a slug of the endpoint,
 * and the short ids the studio has always used — `gemini-flash`, `gemini-pro` —
 * are shorter than that slug. Matching on the endpoint is what lets an override
 * both name the model and keep the id a client already stores.
 */

/** A partial row merged onto the fetched model with the same endpoint. */
export interface ImageModelOverride
  extends Partial<Omit<ImageModel, "generateEndpoint" | "price">> {
  /** The fal endpoint this override belongs to. The match key. */
  endpoint: string;
  price?: Partial<ImageModel["price"]>;
}

/** Capabilities of the three models a person verified by hand on 2026-09-26. */
const VERIFIED_AT = "2026-09-26";
/**
 * Separate from `VERIFIED_AT`: a price moves for reasons a capability does not,
 * and dating them together would let a stale figure ride along behind a
 * capability re-check.
 */
const PRICES_VERIFIED_AT = "2026-09-27";

/**
 * Overrides, applied on top of the fetched rows.
 *
 * A function rather than a module constant so nothing here runs at import time:
 * `catalog.ts` owns the studio vocabulary these rows quote, and reading those
 * constants while `catalog.ts` is still evaluating is how a circular import
 * turns into a startup crash.
 */
export function imageModelOverrides(): ImageModelOverride[] {
  return [
    {
      // Nano Banana 2. The studio's default, and the first model whose
      // capabilities and price a person read off fal's own pages end to end.
      endpoint: "fal-ai/gemini-3.1-flash-image-preview",
      id: "gemini-flash",
      label: "Gemini 3.1 Flash Image",
      description:
        "General image generation and reference editing (Nano Banana 2).",
      aspectRatios: IMAGE_ASPECT_RATIOS,
      resolutions: IMAGE_RESOLUTIONS,
      outputFormats: IMAGE_OUTPUT_FORMATS,
      supportsSeed: true,
      maxReferences: 4,
      dimensionMode: "aspect-ratio",
      providerFields: [
        "aspect_ratio",
        "resolution",
        "output_format",
        "num_images",
        "seed",
        "limit_generations",
        "image_urls",
      ],
      curatedRank: 1,
      notes:
        "Studio exposes up to 2K and four references. Pixel dimensions are chosen by the model; seed does not guarantee identical results.",
      price: {
        // "$0.08 per image. 2K and 4K outputs will be charged at 1.5 times and
        // 2 times the standard rate, respectively. 512x512 resolution outputs
        // will be charged at 0.75 times the standard rate." fal's pricing
        // endpoint reports only the $0.08, so the tiers are verified by hand.
        perImageUsd: { "0.5K": 0.06, "1K": 0.08, "2K": 0.12 },
        basis:
          "$0.08 per image, x0.75 at 0.5K and x1.5 at 2K, as fal lists it. Editing with references is priced the same per image.",
        sourceUrl:
          "https://fal.ai/models/fal-ai/gemini-3.1-flash-image-preview",
        verifiedAt: PRICES_VERIFIED_AT,
      },
      sourceUrls: [
        "https://fal.ai/models/fal-ai/gemini-3.1-flash-image-preview/api",
        "https://fal.ai/models/fal-ai/gemini-3.1-flash-image-preview/edit/api",
      ],
      verifiedAt: VERIFIED_AT,
    },
    {
      // Nano Banana Pro.
      endpoint: "fal-ai/gemini-3-pro-image-preview",
      id: "gemini-pro",
      label: "Gemini 3 Pro Image",
      description:
        "High-fidelity image generation and reference editing (Nano Banana Pro).",
      aspectRatios: IMAGE_ASPECT_RATIOS,
      resolutions: ["1K", "2K"],
      outputFormats: IMAGE_OUTPUT_FORMATS,
      supportsSeed: true,
      maxReferences: 4,
      dimensionMode: "aspect-ratio",
      providerFields: [
        "aspect_ratio",
        "resolution",
        "output_format",
        "num_images",
        "seed",
        "limit_generations",
        "image_urls",
      ],
      curatedRank: 2,
      notes:
        "No 0.5K option. Studio caps output at 2K and four references; actual dimensions come from the provider.",
      price: {
        // "$0.15 per image", with "4K outputs charged at double the standard
        // rate". Studio never asks for 4K, so both tiers it offers are $0.15.
        perImageUsd: { "1K": 0.15, "2K": 0.15 },
        basis:
          "$0.15 per image at every resolution this studio offers, as fal lists it. Only 4K costs more, and the studio never asks for it.",
        sourceUrl: "https://fal.ai/models/fal-ai/gemini-3-pro-image-preview",
        verifiedAt: PRICES_VERIFIED_AT,
      },
      sourceUrls: [
        "https://fal.ai/models/fal-ai/gemini-3-pro-image-preview/api",
        "https://fal.ai/models/fal-ai/gemini-3-pro-image-preview/edit/api",
      ],
      verifiedAt: VERIFIED_AT,
    },
    {
      endpoint: "fal-ai/flux-2-pro",
      id: "flux-2-pro",
      label: "FLUX.2 Pro",
      description:
        "Black Forest Labs image generation, style transfer, and reference editing.",
      aspectRatios: IMAGE_ASPECT_RATIOS,
      resolutions: ["1K", "2K"],
      // No WebP: fal's schema offers jpeg and png only.
      outputFormats: ["png", "jpeg"],
      supportsSeed: true,
      maxReferences: 4,
      dimensionMode: "image-size",
      providerFields: ["image_size", "output_format", "seed", "image_urls"],
      curatedRank: 3,
      notes:
        "Studio maps 1K/2K to a longest edge near 1024/2048 pixels, aligned to 32 pixels. Aspect ratios can differ slightly after alignment. No WebP.",
      price: {
        // Priced by area, so the charge follows the frame and there is no single
        // per-image figure to pin: "$0.03 for the first megapixel of output,
        // plus $0.015 per extra megapixel of input and output". Deliberately no
        // `perImageUsd` here — the megapixel unit derives the charge exactly,
        // and one fixed figure would overcharge every frame narrower than
        // square. References add input megapixels this figure does not carry.
        basis:
          "$0.03 per megapixel of output, as fal lists it. A narrower frame is less area and costs proportionally less; references add input megapixels this figure does not carry.",
        sourceUrl: "https://fal.ai/models/fal-ai/flux-2-pro",
        verifiedAt: PRICES_VERIFIED_AT,
      },
      sourceUrls: [
        "https://fal.ai/models/fal-ai/flux-2-pro/api",
        "https://fal.ai/models/fal-ai/flux-2-pro/edit/api",
      ],
      verifiedAt: VERIFIED_AT,
    },
    {
      // Typography and posters: the shortlist's one reliable letterer.
      endpoint: "fal-ai/ideogram/v3",
      id: "ideogram-v3",
      curatedRank: 4,
      notes:
        "Strongest of the shortlist at typography and poster layout. Capabilities otherwise as fal publishes them.",
    },
    {
      // Vector, icons, and one brand style held across a set.
      endpoint: "fal-ai/recraft/v3/text-to-image",
      id: "recraft-v3",
      curatedRank: 5,
      notes:
        "Vector-leaning output: icons, logos, and a consistent brand style across a set. Capabilities otherwise as fal publishes them.",
    },
  ];
}

/**
 * The curated five, in the order a person is offered them.
 *
 * Ids rather than endpoints because this is what a client sorts on, and they are
 * pinned here so a rename upstream cannot silently empty the shortlist. Asserted
 * against the resolved catalog in tests.
 */
/**
 * fal publishes no usage or popularity figure. `GET /v1/models` rows carry only
 * `highlighted`, `pinned`, `tags` and `is_favorited` (the caller's own), and the
 * usage endpoint reports the calling account's spend, not the platform's. So
 * "most used" cannot be measured; the five are curated by `curatedRank`.
 */
export const CURATED_MODEL_IDS = [
  "gemini-flash",
  "gemini-pro",
  "flux-2-pro",
  "ideogram-v3",
  "recraft-v3",
] as const;

/** Merge the hand-verified layer onto the fetched rows, matching on endpoint. */
export function applyCatalogOverrides(fetched: ImageModel[]): ImageModel[] {
  const byEndpoint = new Map(
    fetched.map((model) => [model.generateEndpoint, model]),
  );
  for (const override of imageModelOverrides()) {
    const base = byEndpoint.get(override.endpoint);
    const { endpoint, price, ...rest } = override;
    if (base) {
      byEndpoint.set(endpoint, {
        ...base,
        ...rest,
        price: { ...base.price, ...price },
      });
      continue;
    }
    // fal did not describe this one well enough to normalise, so the override
    // has to carry the whole row. Without a price unit it cannot be charged for,
    // and a model nobody can be charged for has no business in the catalog.
    if (!price?.unit) continue;
    byEndpoint.set(endpoint, {
      id: rest.id ?? endpoint.replace(/^fal-ai\//, "").replace(/\//g, "-"),
      label: rest.label ?? endpoint,
      description: rest.description ?? "",
      generateEndpoint: endpoint,
      editEndpoint: rest.editEndpoint ?? null,
      aspectRatios: rest.aspectRatios ?? IMAGE_ASPECT_RATIOS,
      resolutions: rest.resolutions ?? ["1K"],
      outputFormats: rest.outputFormats ?? [],
      supportsSeed: rest.supportsSeed ?? false,
      maxReferences: rest.maxReferences ?? 0,
      dimensionMode: rest.dimensionMode ?? "aspect-ratio",
      providerFields: rest.providerFields ?? ["aspect_ratio"],
      curatedRank: rest.curatedRank ?? null,
      notes: rest.notes ?? "",
      price: {
        unit: price.unit,
        unitPriceUsd: price.unitPriceUsd ?? 0,
        perImageUsd: price.perImageUsd,
        basis: price.basis ?? "",
        sourceUrl: price.sourceUrl ?? `https://fal.ai/models/${endpoint}`,
        verifiedAt: price.verifiedAt ?? PRICES_VERIFIED_AT,
      },
      sourceUrls: rest.sourceUrls ?? [`https://fal.ai/models/${endpoint}`],
      verifiedAt: rest.verifiedAt ?? VERIFIED_AT,
    });
  }
  return [...byEndpoint.values()];
}
