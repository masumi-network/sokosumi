/**
 * Maximum text length per social provider for a Social post.
 * Client-safe: web reuses it for composer validation, Core for request validation.
 */
export const SOCIAL_POST_TEXT_LIMITS = {
  x: 280,
  linkedin: 3000,
  facebook: 63206,
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
} as const;

/** Minimum delay before a Social post may be scheduled. */
export const SOCIAL_POST_MIN_SCHEDULE_LEAD_MS = 60 * 1000;

export type SocialPostProvider = keyof typeof SOCIAL_POST_TEXT_LIMITS;

/** Whether a provider accepts a post with text only, media only, or needs video. */
export type SocialPostMediaRequirement = "none" | "any" | "video";

/** Providers whose API refuses a post without text (YouTube's title is derived from it). */
export const SOCIAL_POST_TEXT_REQUIRED = {
  x: false,
  linkedin: true,
  facebook: false,
  instagram: false,
  tiktok: false,
  youtube: true,
} as const satisfies Record<SocialPostProvider, boolean>;

/** Per-provider media requirement: `any` needs image or video, `video` needs exactly one video. */
export const SOCIAL_POST_MEDIA_REQUIREMENTS = {
  x: "none",
  linkedin: "none",
  facebook: "none",
  instagram: "any",
  tiktok: "video",
  youtube: "video",
} as const satisfies Record<SocialPostProvider, SocialPostMediaRequirement>;

const SOCIAL_POST_PROVIDER_LABELS = {
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
} as const satisfies Record<SocialPostProvider, string>;

/** Human-readable provider name for user-facing messages and attempt records. */
export function socialPostProviderLabel(provider: SocialPostProvider): string {
  return SOCIAL_POST_PROVIDER_LABELS[provider];
}

export type SocialPostMediaKind = "image" | "gif" | "video";

/** A Drive file attached to a Social post. Provider media handles are never stored. */
export interface SocialPostMediaRef {
  /** Blob pathname, e.g. `drive/users/{userId}/photo.png`. */
  pathname: string;
  /** Public Vercel Blob URL of the file. */
  fileUrl: string;
  name: string;
  size: number;
  mimeType: string;
  kind: SocialPostMediaKind;
}

const SOCIAL_POST_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const SOCIAL_POST_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Per-provider media rules. Kinds are never mixed; each kind has its own
 * count and byte caps, and a provider only accepts the MIME types it lists.
 */
export const SOCIAL_POST_MEDIA_RULES = {
  x: {
    maxImages: 4,
    maxGifs: 1,
    maxVideos: 1,
    maxImageBytes: 5 * 1024 * 1024,
    maxGifBytes: 15 * 1024 * 1024,
    maxVideoBytes: 100 * 1024 * 1024,
    imageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    gifMimeTypes: ["image/gif"],
    videoMimeTypes: ["video/mp4"],
  },
  linkedin: {
    maxImages: 4,
    maxGifs: 0,
    maxVideos: 1,
    maxImageBytes: SOCIAL_POST_IMAGE_MAX_BYTES,
    maxGifBytes: 0,
    maxVideoBytes: SOCIAL_POST_VIDEO_MAX_BYTES,
    imageMimeTypes: ["image/jpeg", "image/png"],
    gifMimeTypes: [],
    videoMimeTypes: ["video/mp4"],
  },
  facebook: {
    maxImages: 4,
    maxGifs: 0,
    maxVideos: 1,
    maxImageBytes: SOCIAL_POST_IMAGE_MAX_BYTES,
    maxGifBytes: 0,
    maxVideoBytes: SOCIAL_POST_VIDEO_MAX_BYTES,
    imageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    gifMimeTypes: [],
    videoMimeTypes: ["video/mp4"],
  },
  instagram: {
    maxImages: 1,
    maxGifs: 0,
    maxVideos: 1,
    maxImageBytes: SOCIAL_POST_IMAGE_MAX_BYTES,
    maxGifBytes: 0,
    maxVideoBytes: SOCIAL_POST_VIDEO_MAX_BYTES,
    imageMimeTypes: ["image/jpeg"],
    gifMimeTypes: [],
    videoMimeTypes: ["video/mp4", "video/quicktime"],
  },
  tiktok: {
    maxImages: 0,
    maxGifs: 0,
    maxVideos: 1,
    maxImageBytes: SOCIAL_POST_IMAGE_MAX_BYTES,
    maxGifBytes: 0,
    maxVideoBytes: SOCIAL_POST_VIDEO_MAX_BYTES,
    imageMimeTypes: [],
    gifMimeTypes: [],
    videoMimeTypes: ["video/mp4"],
  },
  youtube: {
    maxImages: 0,
    maxGifs: 0,
    maxVideos: 1,
    maxImageBytes: SOCIAL_POST_IMAGE_MAX_BYTES,
    maxGifBytes: 0,
    maxVideoBytes: SOCIAL_POST_VIDEO_MAX_BYTES,
    imageMimeTypes: [],
    gifMimeTypes: [],
    videoMimeTypes: ["video/mp4"],
  },
} as const;

/** Longest text any provider accepts: the provider-agnostic request bound. */
export const SOCIAL_POST_TEXT_MAX = Math.max(
  ...Object.values(SOCIAL_POST_TEXT_LIMITS),
);

/** Most attachments any provider accepts: the provider-agnostic request bound. */
export const SOCIAL_POST_MEDIA_MAX = Math.max(
  ...Object.values(SOCIAL_POST_MEDIA_RULES).map((rules) => rules.maxImages),
);

export type SocialPostMediaValidationReason =
  | "too_many_images"
  | "too_many_gifs"
  | "too_many_videos"
  | "mixed_media"
  | "unsupported_type"
  | "too_large";

export type SocialPostMediaValidation =
  | { ok: true }
  | { ok: false; reason: SocialPostMediaValidationReason };

const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
};

function includesMime(list: readonly string[], mime: string): boolean {
  return (list as readonly string[]).includes(mime);
}

function mimeTypesForKind(
  rules: (typeof SOCIAL_POST_MEDIA_RULES)[SocialPostProvider],
  kind: SocialPostMediaKind,
): readonly string[] {
  switch (kind) {
    case "image":
      return rules.imageMimeTypes;
    case "gif":
      return rules.gifMimeTypes;
    case "video":
      return rules.videoMimeTypes;
  }
}

/** Every MIME type any provider accepts, grouped by the media kind it maps to. */
const ALL_IMAGE_MIME_TYPES = new Set(
  Object.values(SOCIAL_POST_MEDIA_RULES).flatMap(
    (rules) => rules.imageMimeTypes as readonly string[],
  ),
);
const ALL_GIF_MIME_TYPES = new Set(
  Object.values(SOCIAL_POST_MEDIA_RULES).flatMap(
    (rules) => rules.gifMimeTypes as readonly string[],
  ),
);
const ALL_VIDEO_MIME_TYPES = new Set(
  Object.values(SOCIAL_POST_MEDIA_RULES).flatMap(
    (rules) => rules.videoMimeTypes as readonly string[],
  ),
);

/**
 * Media kind for a mime type, or `null` when no provider accepts it. The
 * provider's own allowed list is enforced by {@link validateSocialPostMedia}.
 */
export function socialPostMediaKindForMime(
  mime: string,
): SocialPostMediaKind | null {
  const normalized = mime.trim().toLowerCase();
  if (ALL_IMAGE_MIME_TYPES.has(normalized)) return "image";
  if (ALL_GIF_MIME_TYPES.has(normalized)) return "gif";
  if (ALL_VIDEO_MIME_TYPES.has(normalized)) return "video";
  return null;
}

/** Supported media mime type derived from a file name's extension, or `null`. */
export function socialPostMimeForFileName(name: string): string | null {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return EXTENSION_MIME_TYPES[base.slice(dot + 1).toLowerCase()] ?? null;
}

/** Byte cap for one media kind under the provider's rules. */
export function socialPostMaxBytesForKind(
  provider: SocialPostProvider,
  kind: SocialPostMediaKind,
): number {
  const rules = SOCIAL_POST_MEDIA_RULES[provider];
  switch (kind) {
    case "image":
      return rules.maxImageBytes;
    case "gif":
      return rules.maxGifBytes;
    case "video":
      return rules.maxVideoBytes;
  }
}

/**
 * Applies the provider's media rules to a set of refs: supported types whose
 * `kind` matches the mime, one kind per post, per-kind counts and byte caps.
 */
export function validateSocialPostMedia(
  provider: SocialPostProvider,
  media: readonly SocialPostMediaRef[],
): SocialPostMediaValidation {
  const rules = SOCIAL_POST_MEDIA_RULES[provider];
  if (media.length === 0) return { ok: true };

  for (const item of media) {
    if (socialPostMediaKindForMime(item.mimeType) !== item.kind) {
      return { ok: false, reason: "unsupported_type" };
    }
    const mimeType = item.mimeType.trim().toLowerCase();
    if (!includesMime(mimeTypesForKind(rules, item.kind), mimeType)) {
      return { ok: false, reason: "unsupported_type" };
    }
  }

  const kinds = new Set(media.map((item) => item.kind));
  if (kinds.size > 1) return { ok: false, reason: "mixed_media" };

  const kind = media[0].kind;
  if (kind === "image" && media.length > rules.maxImages) {
    return { ok: false, reason: "too_many_images" };
  }
  if (kind === "gif" && media.length > rules.maxGifs) {
    return { ok: false, reason: "too_many_gifs" };
  }
  if (kind === "video" && media.length > rules.maxVideos) {
    return { ok: false, reason: "too_many_videos" };
  }

  const maxBytes = socialPostMaxBytesForKind(provider, kind);
  if (media.some((item) => item.size > maxBytes)) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true };
}
