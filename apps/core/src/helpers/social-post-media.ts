import {
  type SocialPostMediaKind,
  type SocialPostMediaRef,
  type SocialPostProvider,
  socialPostMaxBytesForKind,
  socialPostMediaKindForMime,
  socialPostProviderLabel,
} from "@sokosumi/utils";
import type { SocialPostMediaBytes } from "@/clients/social-post-providers/types";
import {
  DriveFileDownloadError,
  downloadDriveFile,
} from "@/helpers/drive-file-download";
import { socialPostMediaRefSchema } from "@/schemas/social-post.schema";

const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000;

export type SocialPostMediaErrorKind =
  | "media_missing"
  | "media_type_mismatch"
  | "media_too_large"
  | "unsupported_provider";

/** A Drive file cannot be published as-is; retrying will not help. */
export class SocialPostMediaError extends Error {
  constructor(
    readonly kind: SocialPostMediaErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SocialPostMediaError";
  }
}

function parseRefs(value: unknown): SocialPostMediaRef[] | null {
  if (value === null || value === undefined) return [];
  const parsed = socialPostMediaRefSchema.array().safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Reads the `media` Json column; malformed rows are logged and treated as no media. */
export function parseSocialPostMedia(
  value: unknown,
  postId: string,
): SocialPostMediaRef[] {
  const refs = parseRefs(value);
  if (refs) return refs;
  console.warn("[social-post] Ignoring malformed media refs", { postId });
  return [];
}

/**
 * Publish-time variant: a non-empty `media` column that cannot be read fails
 * the post instead of silently publishing text only.
 */
export function requireSocialPostMedia(
  value: unknown,
  postId: string,
): SocialPostMediaRef[] {
  const refs = parseRefs(value);
  if (refs) return refs;
  console.warn("[social-post] Unreadable media refs", { postId });
  throw new SocialPostMediaError(
    "media_missing",
    "The attached media could not be read. Re-attach the files and try again",
  );
}

function kindLabel(kind: SocialPostMediaKind): string {
  switch (kind) {
    case "image":
      return "an image";
    case "gif":
      return "a GIF";
    case "video":
      return "a video";
  }
}

async function downloadOne(
  provider: SocialPostProvider,
  ref: SocialPostMediaRef,
  signal?: AbortSignal,
): Promise<SocialPostMediaBytes> {
  const label = socialPostProviderLabel(provider);
  try {
    const { bytes, mimeType } = await downloadDriveFile(ref.fileUrl, {
      maxBytes: socialPostMaxBytesForKind(provider, ref.kind),
      timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS,
      acceptsMimeType: (mime) => socialPostMediaKindForMime(mime) === ref.kind,
      signal,
    });
    return { bytes, name: ref.name, mimeType, kind: ref.kind };
  } catch (error) {
    if (!(error instanceof DriveFileDownloadError)) throw error;
    switch (error.reason) {
      case "too_large":
        throw new SocialPostMediaError(
          "media_too_large",
          `Media file "${ref.name}" is too large for ${label}`,
        );
      case "unavailable":
        throw new SocialPostMediaError(
          "media_missing",
          `Media file "${ref.name}" is no longer available`,
        );
      case "wrong_type":
        throw new SocialPostMediaError(
          "media_type_mismatch",
          `Media file "${ref.name}" is not ${kindLabel(ref.kind)}`,
        );
    }
  }
}

/**
 * Fetches every attached Drive file server-side through the SSRF guard and
 * checks it still matches what was validated at schedule time.
 */
export async function downloadSocialPostMedia(
  provider: SocialPostProvider,
  media: readonly SocialPostMediaRef[],
  signal?: AbortSignal,
): Promise<SocialPostMediaBytes[]> {
  const downloaded: SocialPostMediaBytes[] = [];
  for (const ref of media) {
    signal?.throwIfAborted();
    downloaded.push(await downloadOne(provider, ref, signal));
  }
  return downloaded;
}
