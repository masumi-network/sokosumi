import { SsrfError, ssrfSafeFetch } from "@sokosumi/net";
import {
  SOCIAL_POST_MEDIA_RULES,
  type SocialPostMediaKind,
  type SocialPostMediaRef,
  socialPostMediaKindForMime,
} from "@sokosumi/utils";

import type { PublishXMediaInput } from "@/clients/composio.client";
import { socialPostMediaRefSchema } from "@/schemas/social-post.schema";

const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000;

export type SocialPostMediaErrorKind =
  | "media_missing"
  | "media_type_mismatch"
  | "media_too_large";

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

export function socialPostMediaMaxBytes(kind: SocialPostMediaKind): number {
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

/** Base MIME type of a response, lowercased and stripped of parameters. */
function servedMimeType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
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
  ref: SocialPostMediaRef,
  signal?: AbortSignal,
): Promise<PublishXMediaInput> {
  const maxBytes = socialPostMediaMaxBytes(ref.kind);
  let response: Response;
  try {
    response = await ssrfSafeFetch(ref.fileUrl, {
      maxResponseBytes: maxBytes,
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof SsrfError && /maxResponseBytes/.test(error.message)) {
      throw new SocialPostMediaError(
        "media_too_large",
        `Media file "${ref.name}" is too large for X`,
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new SocialPostMediaError(
      "media_missing",
      `Media file "${ref.name}" is no longer available`,
    );
  }
  const servedMime = servedMimeType(response.headers.get("content-type"));
  if (socialPostMediaKindForMime(servedMime) !== ref.kind) {
    throw new SocialPostMediaError(
      "media_type_mismatch",
      `Media file "${ref.name}" is not ${kindLabel(ref.kind)}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new SocialPostMediaError(
      "media_too_large",
      `Media file "${ref.name}" is too large for X`,
    );
  }
  return { bytes, name: ref.name, mimeType: servedMime, kind: ref.kind };
}

/**
 * Fetches every attached Drive file server-side through the SSRF guard and
 * checks it still matches what was validated at schedule time.
 */
export async function downloadSocialPostMedia(
  media: readonly SocialPostMediaRef[],
  signal?: AbortSignal,
): Promise<PublishXMediaInput[]> {
  const downloaded: PublishXMediaInput[] = [];
  for (const ref of media) {
    signal?.throwIfAborted();
    downloaded.push(await downloadOne(ref, signal));
  }
  return downloaded;
}
