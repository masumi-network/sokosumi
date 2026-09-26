/** Studio-supported subset of the linked provider schemas, checked 2026-09-26. */
export const IMAGE_MODEL_IDS = [
  "gemini-flash",
  "gemini-pro",
  "flux-2-pro",
] as const;
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
export const IMAGE_RESOLUTIONS = ["0.5K", "1K", "2K"] as const;
export const IMAGE_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export const DEFAULT_IMAGE_MODEL_ID = "gemini-flash";

const VERIFIED_AT = "2026-09-26";

export interface ImageModel {
  id: string;
  label: string;
  description: string;
  generateEndpoint: string;
  editEndpoint: string;
  aspectRatios: readonly string[];
  resolutions: readonly string[];
  outputFormats: readonly string[];
  supportsSeed: boolean;
  maxReferences: number;
  dimensionMode: "aspect-ratio" | "image-size";
  notes: string;
  sourceUrls: string[];
  verifiedAt: string;
}

// Endpoint metadata is also historical provenance: retain entries when models
// are withdrawn, so saved versions can still be labeled by their endpoint.
export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "gemini-flash",
    label: "Gemini 3.1 Flash Image",
    description:
      "General image generation and reference editing (Nano Banana 2).",
    generateEndpoint: "fal-ai/gemini-3.1-flash-image-preview",
    editEndpoint: "fal-ai/gemini-3.1-flash-image-preview/edit",
    aspectRatios: IMAGE_ASPECT_RATIOS,
    resolutions: IMAGE_RESOLUTIONS,
    outputFormats: IMAGE_OUTPUT_FORMATS,
    supportsSeed: true,
    maxReferences: 4,
    dimensionMode: "aspect-ratio",
    notes:
      "Studio exposes up to 2K and four references. Pixel dimensions are chosen by the model; seed does not guarantee identical results.",
    sourceUrls: [
      "https://fal.ai/models/fal-ai/gemini-3.1-flash-image-preview/api",
      "https://fal.ai/models/fal-ai/gemini-3.1-flash-image-preview/edit/api",
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "gemini-pro",
    label: "Gemini 3 Pro Image",
    description:
      "High-fidelity image generation and reference editing (Nano Banana Pro).",
    generateEndpoint: "fal-ai/gemini-3-pro-image-preview",
    editEndpoint: "fal-ai/gemini-3-pro-image-preview/edit",
    aspectRatios: IMAGE_ASPECT_RATIOS,
    resolutions: ["1K", "2K"],
    outputFormats: IMAGE_OUTPUT_FORMATS,
    supportsSeed: true,
    maxReferences: 4,
    dimensionMode: "aspect-ratio",
    notes:
      "No 0.5K option. Studio caps output at 2K and four references; actual dimensions come from the provider.",
    sourceUrls: [
      "https://fal.ai/models/fal-ai/gemini-3-pro-image-preview/api",
      "https://fal.ai/models/fal-ai/gemini-3-pro-image-preview/edit/api",
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "flux-2-pro",
    label: "FLUX.2 Pro",
    description:
      "Black Forest Labs image generation, style transfer, and reference editing.",
    generateEndpoint: "fal-ai/flux-2-pro",
    editEndpoint: "fal-ai/flux-2-pro/edit",
    aspectRatios: IMAGE_ASPECT_RATIOS,
    resolutions: ["1K", "2K"],
    outputFormats: ["png", "jpeg"],
    supportsSeed: true,
    maxReferences: 4,
    dimensionMode: "image-size",
    notes:
      "Studio maps 1K/2K to a longest edge near 1024/2048 pixels, aligned to 32 pixels. Aspect ratios can differ slightly after alignment. No WebP.",
    sourceUrls: [
      "https://fal.ai/models/fal-ai/flux-2-pro/api",
      "https://fal.ai/models/fal-ai/flux-2-pro/edit/api",
    ],
    verifiedAt: VERIFIED_AT,
  },
];

export interface ImagePlacement {
  id: string;
  platform: string;
  label: string;
  aspectRatio: string;
  width: number;
  height: number;
  notes: string;
  sourceUrl: string;
  verifiedAt: string;
}

export const IMAGE_PLACEMENTS: ImagePlacement[] = [
  ...["Instagram", "Facebook"].map((platform) => ({
    id: `${platform.toLowerCase()}-reels`,
    platform,
    label: "Reels image concept",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    notes:
      "Studio canvas for a 9:16 Reels image concept, not a finished video or a platform pixel requirement. Keep key content away from interface overlays.",
    sourceUrl:
      "https://www.facebook.com/business/ads/facebook-instagram-reels-ads",
    verifiedAt: VERIFIED_AT,
  })),
  {
    id: "x-square",
    platform: "X",
    label: "Square image ad",
    aspectRatio: "1:1",
    width: 1200,
    height: 1200,
    notes:
      "Recommended target for standalone image ads, not every X placement. Export resizing may be needed.",
    sourceUrl:
      "https://business.x.com/en/help/campaign-setup/creative-ad-specifications",
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "pinterest-pin",
    platform: "Pinterest",
    label: "Standard Pin",
    aspectRatio: "2:3",
    width: 1000,
    height: 1500,
    notes:
      "Recommended standard image Pin target. Taller Pins may be cropped in feeds. Export resizing may be needed.",
    sourceUrl:
      "https://help.pinterest.com/en/business/article/pinterest-product-specs",
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "youtube-thumbnail",
    platform: "YouTube",
    label: "Video thumbnail",
    aspectRatio: "16:9",
    width: 3840,
    height: 2160,
    notes:
      "YouTube recommends 3840×2160. Studio generates at up to 2K, so this is a composition target, not a promise of that resolution. Check file size before upload.",
    sourceUrl: "https://support.google.com/youtube/answer/72431",
    verifiedAt: VERIFIED_AT,
  },
];

export const IMAGE_STUDIO_CATALOG = {
  defaultModelId: DEFAULT_IMAGE_MODEL_ID,
  models: IMAGE_MODELS,
  placements: IMAGE_PLACEMENTS,
};

export function imageModel(id: string = DEFAULT_IMAGE_MODEL_ID): ImageModel {
  const model = IMAGE_MODELS.find((candidate) => candidate.id === id);
  if (!model)
    throw new Error(
      "Unsupported image model. Choose a model from the studio catalog.",
    );
  return model;
}

export function imageModelForEndpoint(endpoint: string): ImageModel {
  const model = IMAGE_MODELS.find(
    (candidate) =>
      candidate.generateEndpoint === endpoint ||
      candidate.editEndpoint === endpoint,
  );
  if (!model) throw new Error("Unsupported image model endpoint.");
  return model;
}

export interface ImageSettings {
  aspectRatio: string;
  resolution: string;
  outputFormat: string;
  seed: number | null;
  placementId?: string | null;
}

/** Used before reservation by both browser and agent calls. */
export function resolveImageSettings(
  modelId: string | undefined,
  settings: ImageSettings,
  referenceCount: number,
): ImageSettings {
  const model = imageModel(modelId);
  const placement = settings.placementId
    ? IMAGE_PLACEMENTS.find((item) => item.id === settings.placementId)
    : null;
  if (settings.placementId != null && !placement)
    throw new Error("Unsupported image placement.");
  const resolved = {
    ...settings,
    aspectRatio: placement?.aspectRatio ?? settings.aspectRatio,
  };
  if (!model.aspectRatios.includes(resolved.aspectRatio))
    throw new Error(`${model.label} does not support this aspect ratio.`);
  if (!model.resolutions.includes(resolved.resolution))
    throw new Error(`${model.label} does not support this resolution.`);
  if (!model.outputFormats.includes(resolved.outputFormat))
    throw new Error(`${model.label} does not support this output format.`);
  if (referenceCount > model.maxReferences)
    throw new Error(
      `${model.label} supports at most ${model.maxReferences} references in Studio.`,
    );
  if (
    resolved.seed !== null &&
    (!Number.isInteger(resolved.seed) ||
      resolved.seed < 0 ||
      resolved.seed > 2_147_483_647)
  )
    throw new Error("Seed must be an integer between 0 and 2147483647.");
  return resolved;
}

export function imageDimensions(aspectRatio: string, resolution: string) {
  const [width, height] = aspectRatio.split(":").map(Number);
  const edge = resolution === "2K" ? 2048 : 1024;
  return {
    width: Math.round((edge * width) / Math.max(width, height) / 32) * 32,
    height: Math.round((edge * height) / Math.max(width, height) / 32) * 32,
  };
}
