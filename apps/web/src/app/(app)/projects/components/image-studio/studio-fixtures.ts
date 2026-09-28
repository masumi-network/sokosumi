import type { StudioCatalog, StudioLabels } from "./types";

/**
 * Every label as its own key, for tests.
 *
 * A proxy rather than a literal, so adding a label never breaks an unrelated
 * test — but the **record-valued** labels are spelled out, because a flat proxy
 * hands back the string `"failedBody"` and indexing that by a reason gives
 * `undefined`. That renders as an empty sentence and slips past a loose
 * assertion, which it has now done twice: once for `templateLabels` and once
 * for `failedBody`. Adding a third record-valued label means adding it here.
 */
const echoKeys = new Proxy({}, { get: (_target, key: string) => key });

export const TEST_LABELS = new Proxy(
  {
    templateLabels: echoKeys,
    failedBody: echoKeys,
  } as Record<string, unknown>,
  { get: (target, key: string) => target[key] ?? key },
) as unknown as StudioLabels;

/**
 * A catalog shaped like the one Core sends, for tests only.
 *
 * Deliberately not a copy of the real one. It carries two models whose
 * capabilities *differ* — one without 0.5K, one without a seed, one with a
 * ratio the other lacks — because everything interesting in the UI happens at
 * those differences: clamping when the model changes and intersecting the
 * options when several are selected. A fixture where every model supports
 * everything would pass while the product was broken.
 *
 * The prices differ the same way and on purpose. Model A is priced per image;
 * Model B is priced per megapixel with a hand-verified 1K figure and none above
 * it, so 1K reads a fixed price and 2K is derived from the output area. Both are
 * real shapes the real catalog holds, and both are how `creditsPerImageCents`
 * can disagree with itself if the wrong branch is taken.
 */
export const TEST_CATALOG: StudioCatalog = {
  defaultModelId: "model-a",
  models: [
    {
      id: "model-a",
      label: "Model A",
      description: "Fast",
      generateEndpoint: "vendor/model-a",
      editEndpoint: "vendor/model-a/edit",
      aspectRatios: ["1:1", "4:5", "16:9", "9:16"],
      resolutions: ["0.5K", "1K", "2K"],
      outputFormats: ["png", "jpeg", "webp"],
      supportsSeed: true,
      maxReferences: 4,
      dimensionMode: "aspect-ratio",
      providerFields: ["aspect_ratio", "output_format", "seed", "num_images"],
      curatedRank: 1,
      notes: "",
      price: {
        unit: "images",
        unitPriceUsd: 0.04,
        perImageUsd: { "0.5K": 0.02, "1K": 0.04, "2K": 0.08 },
        basis: "Four cents an image at 1K, for the sake of the arithmetic.",
        sourceUrl: "https://example.test/model-a/pricing",
        verifiedAt: "2026-09-27",
      },
      sourceUrls: [],
      verifiedAt: "2026-09-26",
    },
    {
      id: "model-b",
      label: "Model B",
      description: "Detailed",
      generateEndpoint: "vendor/model-b",
      editEndpoint: "vendor/model-b/edit",
      aspectRatios: ["1:1", "4:5", "16:9"],
      resolutions: ["1K", "2K"],
      outputFormats: ["png", "jpeg"],
      supportsSeed: false,
      maxReferences: 2,
      dimensionMode: "image-size",
      providerFields: ["image_size", "output_format"],
      curatedRank: 2,
      notes: "",
      price: {
        // Priced by area, and with a hand-verified 1K figure but none at 2K, so
        // 2K falls through to the unit price and 1K does not. Both branches of
        // `creditsPerImageCents` are exercised by one fixture.
        unit: "megapixels",
        unitPriceUsd: 0.05,
        perImageUsd: { "1K": 0.1 },
        basis: "Ten cents an image at 1K, five cents a megapixel above it.",
        sourceUrl: "https://example.test/model-b/pricing",
        verifiedAt: "2026-09-27",
      },
      sourceUrls: [],
      verifiedAt: "2026-09-26",
    },
  ],
  snapshotDate: "2026-09-27",
  refreshedAt: null,
};
