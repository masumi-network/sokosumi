import { X_COUNTRY_TLDS, X_GENERIC_TLDS } from "./x-tlds.js";

/**
 * Default maximum text length per social provider for a Social post.
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

export const X_PREMIUM_TEXT_LIMIT = 25_000;
// Every Premium tier includes longer posts: https://help.x.com/en/using-x/x-premium
export const X_LONG_POST_SUBSCRIPTION_TYPES = [
  "Basic",
  "Premium",
  "PremiumPlus",
] as const;
export type XLongPostSubscriptionType =
  (typeof X_LONG_POST_SUBSCRIPTION_TYPES)[number];

export function socialPostTextLimit(
  provider: SocialPostProvider,
  subscriptionType?: string | null,
): number {
  return provider === "x" &&
    X_LONG_POST_SUBSCRIPTION_TYPES.some((tier) => tier === subscriptionType)
    ? X_PREMIUM_TEXT_LIMIT
    : SOCIAL_POST_TEXT_LIMITS[provider];
}

const X_GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });
const X_EMOJI = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F|[0-9#*]\uFE0F?\u20E3/u;
// Bare hosts use twitter-text's TLD lists and short ccTLD rule.
const X_URL_DOMAIN = String.raw`(?:[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?\.)+`;
const X_URL_TLD_PREFIX = new RegExp(
  `^(?:${[...X_GENERIC_TLDS, ...X_COUNTRY_TLDS].sort((a, b) => b.length - a.length).join("|")})(?=[^a-z0-9@+-]|$)`,
  "iu",
);
// Path/query character sets follow twitter-text (Apache-2.0, Copyright 2018 Twitter, Inc.).
// https://github.com/twitter/twitter-text/tree/master/js/src/regexp
const X_LATIN_ACCENTS = String.raw`\xC0-\xD6\xD8-\xF6\xF8-\xFF\u0100-\u024F\u0253\u0254\u0256\u0257\u0259\u025B\u0263\u0268\u026F\u0272\u0289\u028B\u02BB\u0300-\u036F\u1E00-\u1EFF`;
const X_URL_HOST = String.raw`[^\s\x00-\x1f\x7f!"#$%&'()*+,/:;<=>?@\[\]^\x60{|}~\\\uFFFE\uFEFF\uFFFF\u202A-\u202E\u2066-\u2069]+`;
const X_URL_PATH_CHARS = String.raw`[a-z0-9${X_LATIN_ACCENTS}\u0400-\u04FF!*';:=+,.$/%#\[\]\u2013_~@|&\-]`;
const X_URL_PARENS = String.raw`\((?:${X_URL_PATH_CHARS}+|${X_URL_PATH_CHARS}*\(${X_URL_PATH_CHARS}+\)${X_URL_PATH_CHARS}*)\)`;
const X_URL_PATH_END = String.raw`(?:[+\-a-z0-9${X_LATIN_ACCENTS}\u0400-\u04FF=_#\/]|${X_URL_PARENS})`;
const X_URL_PATH = String.raw`(?:${X_URL_PATH_CHARS}*(?:${X_URL_PARENS}${X_URL_PATH_CHARS}*)*${X_URL_PATH_END}|@${X_URL_PATH_CHARS}+/)`;
const X_URL_QUERY = String.raw`[a-z0-9!?*'@();:&=+$/%#\[\]_.,~|\-]`;
const X_ASCII_DOMAIN_PREFIX = new RegExp(
  String.raw`[a-z0-9${X_LATIN_ACCENTS}\-]+(?:\.[a-z0-9${X_LATIN_ACCENTS}\-]+)*\.$`,
  "iu",
);
const X_URL = new RegExp(
  String.raw`(?:(?<![a-z0-9@＠])https?:\/\/(${X_URL_HOST})|(?<![\p{L}\p{M}\p{N}._@＠$#＃])(${X_URL_DOMAIN}[\p{L}\p{M}\p{N}_-]*))(?::[0-9]+)?(\/${X_URL_PATH}*)?(?:\?${X_URL_QUERY}*[a-z0-9\-_&=#/])?`,
  "giu",
);

function xCharacterLength(text: string): number {
  let length = 0;
  for (const { segment } of X_GRAPHEMES.segment(text)) {
    if (X_EMOJI.test(segment)) {
      length += 2;
      continue;
    }
    for (const character of segment) {
      const point = character.codePointAt(0)!;
      length +=
        point <= 0x10ff ||
        (point >= 0x2000 && point <= 0x200d) ||
        (point >= 0x2010 && point <= 0x201f) ||
        (point >= 0x2032 && point <= 0x2037)
          ? 1
          : 2;
    }
  }
  return length;
}

/** X v3 weights: t.co URLs cost 23; emoji sequences cost 2. Other providers keep UTF-16 length. */
export function socialPostTextLength(
  provider: SocialPostProvider,
  text: string,
): number {
  if (provider !== "x") return text.length;
  const normalized = text.normalize("NFC");
  if (!normalized.includes(".")) return xCharacterLength(normalized);
  let length = 0;
  let end = 0;
  const urls = new RegExp(X_URL);
  for (
    let match = urls.exec(normalized);
    match;
    match = urls.exec(normalized)
  ) {
    let start = match.index;
    let candidate = match[0];
    const explicit = match[1] !== undefined;
    let hostname = match[1] ?? match[2];
    let hasPath = Boolean(match[3]);
    if (!explicit && hostname.endsWith(".")) {
      hostname = hostname.replace(/\.+$/, "");
      candidate = hostname;
      hasPath = false;
    }
    const tldStart = hostname.lastIndexOf(".") + 1;
    const tld = hostname.slice(tldStart);
    const knownTld = tld.match(X_URL_TLD_PREFIX)?.[0];
    if (knownTld && knownTld.length < tld.length) {
      hostname = hostname.slice(0, tldStart + knownTld.length);
      candidate = candidate.slice(
        0,
        (explicit ? candidate.indexOf("://") + 3 : 0) + hostname.length,
      );
      hasPath = false;
    }
    if (!explicit) {
      const dot = hostname.lastIndexOf(".");
      const prefix = hostname
        .slice(0, dot + 1)
        .match(X_ASCII_DOMAIN_PREFIX)?.[0];
      if (!prefix) continue;
      const skipped = dot + 1 - prefix.length;
      start += skipped;
      candidate = candidate.slice(skipped);
      hostname = hostname.slice(skipped);
    }
    const preceding = normalized.slice(0, start);
    if (
      /[a-z0-9@＠]$/i.test(preceding) ||
      (!explicit && /[_$#＃]$/.test(preceding))
    ) {
      continue;
    }
    if (!explicit) {
      const labels = hostname.toLowerCase().split(".");
      const tld = labels[labels.length - 1];
      const isCountry = X_COUNTRY_TLDS.has(tld);
      if (!X_GENERIC_TLDS.has(tld) && !isCountry) continue;
      if (
        isCountry &&
        labels.length === 2 &&
        !hasPath &&
        tld !== "co" &&
        tld !== "tv"
      ) {
        continue;
      }
    }
    // Sentence punctuation stays outside the link, as do unmatched closing parentheses.
    let url = candidate.replace(/[.,!?;:'"…]+$/, "");
    while (
      url.endsWith(")") &&
      (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)
    ) {
      url = url.slice(0, -1);
    }
    try {
      const parsed = new URL(
        /^https?:\/\//i.test(url) ? url : `https://${url}`,
      );
      if (!parsed.hostname.includes(".")) continue;
    } catch {
      continue;
    }
    length += xCharacterLength(normalized.slice(end, start)) + 23;
    end = start + url.length;
    urls.lastIndex = end;
  }
  return length + xCharacterLength(normalized.slice(end));
}

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

const YOUTUBE_TITLE_LIMIT = 100;

/** First non-empty line is the title; overflow and later lines form the description. */
export function splitYouTubePostText(text: string) {
  const lines = text.split(/\r?\n/);
  const titleIndex = lines.findIndex((part) => part.trim().length > 0);
  if (titleIndex === -1) return { title: "", description: "" };
  const titleLine = lines[titleIndex].trim();
  const overflow = titleLine.slice(YOUTUBE_TITLE_LIMIT).trim();
  const rest = lines
    .slice(titleIndex + 1)
    .join("\n")
    .trim();
  return {
    title: titleLine.slice(0, YOUTUBE_TITLE_LIMIT),
    description: [overflow, rest].filter((part) => part.length > 0).join("\n"),
  };
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

/** Whether attached media satisfies the provider's presence rule. */
export function socialPostMeetsMediaRequirement(
  provider: SocialPostProvider,
  media: readonly SocialPostMediaRef[],
): boolean {
  const requirement = SOCIAL_POST_MEDIA_REQUIREMENTS[provider];
  if (requirement === "none") return true;
  if (requirement === "any") return media.length > 0;
  return media.length === 1 && media[0]?.kind === "video";
}

/**
 * Why the provider still needs media, or `null` when presence is optional.
 * Create and schedule use this; MIME and count rules are separate.
 */
export function socialPostMediaRequirementMessage(
  provider: SocialPostProvider,
): string | null {
  const requirement = SOCIAL_POST_MEDIA_REQUIREMENTS[provider];
  if (requirement === "none") return null;
  const label = socialPostProviderLabel(provider);
  return requirement === "any"
    ? `${label} requires at least one image or video`
    : `${label} requires a video`;
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

/**
 * Comment length after a successful publish. TikTok has no Composio comment
 * tool, so it is omitted. Instagram's tool caps at 300.
 */
export const SOCIAL_POST_FIRST_COMMENT_LIMITS = {
  x: 280,
  linkedin: 1250,
  facebook: 8000,
  instagram: 300,
  tiktok: null,
  youtube: 10_000,
} as const satisfies Record<SocialPostProvider, number | null>;

/** Longest first comment any supporting provider accepts. */
export const SOCIAL_POST_FIRST_COMMENT_MAX = Math.max(
  X_PREMIUM_TEXT_LIMIT,
  SOCIAL_POST_FIRST_COMMENT_LIMITS.linkedin,
  SOCIAL_POST_FIRST_COMMENT_LIMITS.facebook,
  SOCIAL_POST_FIRST_COMMENT_LIMITS.instagram,
  SOCIAL_POST_FIRST_COMMENT_LIMITS.youtube,
);

/** Comment cap for a provider, or `null` when Composio cannot post one. */
export function socialPostFirstCommentLimit(
  provider: SocialPostProvider,
  subscriptionType?: string | null,
): number | null {
  return provider === "x"
    ? socialPostTextLimit(provider, subscriptionType)
    : SOCIAL_POST_FIRST_COMMENT_LIMITS[provider];
}

export function socialPostSupportsFirstComment(
  provider: SocialPostProvider,
): boolean {
  return socialPostFirstCommentLimit(provider) !== null;
}

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
