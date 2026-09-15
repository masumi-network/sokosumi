/**
 * Maximum text length per social provider for a Social post.
 * Client-safe: web reuses it for composer validation, Core for request validation.
 */
export const SOCIAL_POST_TEXT_LIMITS = { x: 280 } as const;

export type SocialPostProvider = keyof typeof SOCIAL_POST_TEXT_LIMITS;

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

/**
 * Per-provider media rules. X allows up to four images, or one GIF, or one
 * video; kinds are never mixed and each kind has its own byte cap.
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
    videoMimeTypes: ["video/mp4", "video/quicktime"],
  },
} as const;

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
  mov: "video/quicktime",
};

function includesMime(list: readonly string[], mime: string): boolean {
  return (list as readonly string[]).includes(mime);
}

/** Media kind for a mime type under the X rules, or `null` when unsupported. */
export function socialPostMediaKindForMime(
  mime: string,
): SocialPostMediaKind | null {
  const normalized = mime.trim().toLowerCase();
  const rules = SOCIAL_POST_MEDIA_RULES.x;
  if (includesMime(rules.imageMimeTypes, normalized)) return "image";
  if (includesMime(rules.gifMimeTypes, normalized)) return "gif";
  if (includesMime(rules.videoMimeTypes, normalized)) return "video";
  return null;
}

/** Supported media mime type derived from a file name's extension, or `null`. */
export function socialPostMimeForFileName(name: string): string | null {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return EXTENSION_MIME_TYPES[base.slice(dot + 1).toLowerCase()] ?? null;
}

function maxBytesForKind(kind: SocialPostMediaKind): number {
  const rules = SOCIAL_POST_MEDIA_RULES.x;
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

  const maxBytes = maxBytesForKind(kind);
  if (media.some((item) => item.size > maxBytes)) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true };
}
