import type { StudioCatalog } from "./types";

/**
 * A catalog shaped like the one Core sends, for tests only.
 *
 * Deliberately not a copy of the real one. It carries three models whose
 * capabilities *differ* — one without 0.5K, one without a seed, one with a
 * ratio the others lack — because everything interesting in the UI happens at
 * those differences: clamping when the model changes, intersecting the
 * options when several are selected, and refusing a placement a model cannot
 * frame. A fixture where every model supports everything would pass while the
 * product was broken.
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
      notes: "",
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
      notes: "",
      sourceUrls: [],
      verifiedAt: "2026-09-26",
    },
  ],
  placements: [
    {
      id: "reels",
      platform: "instagram",
      label: "Instagram Reels",
      aspectRatio: "9:16",
      width: 1080,
      height: 1920,
      notes: "",
      sourceUrl: "https://example.test/reels",
      verifiedAt: "2026-09-26",
    },
    {
      id: "square",
      platform: "x",
      label: "X square",
      aspectRatio: "1:1",
      width: 1200,
      height: 1200,
      notes: "",
      sourceUrl: "https://example.test/x",
      verifiedAt: "2026-09-26",
    },
  ],
};
