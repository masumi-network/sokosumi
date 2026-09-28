import {
  type SocialPostMediaRef,
  socialPostMediaKindForMime,
  socialPostMimeForFileName,
} from "@sokosumi/utils";

import type { DriveFile } from "@/lib/clients/generated/core/types.gen";

interface SocialPostMediaSource {
  name: string;
  size: number;
  pathname: string;
  fileUrl: string;
}

/**
 * Builds a media ref from an uploaded or picked Drive file, or null when the
 * file name maps to no media type X accepts.
 */
export function buildSocialPostMediaRef(
  source: SocialPostMediaSource,
): SocialPostMediaRef | null {
  const mimeType = socialPostMimeForFileName(source.name);
  if (!mimeType) return null;
  const kind = socialPostMediaKindForMime(mimeType);
  if (!kind) return null;
  return {
    pathname: source.pathname,
    fileUrl: source.fileUrl,
    name: source.name,
    size: source.size,
    mimeType,
    kind,
  };
}

export function socialPostMediaRefFromDriveFile(
  file: DriveFile,
): SocialPostMediaRef | null {
  return buildSocialPostMediaRef(file);
}

function pathnameCounts(
  refs: readonly SocialPostMediaRef[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    counts.set(ref.pathname, (counts.get(ref.pathname) ?? 0) + 1);
  }
  return counts;
}

/** Order-insensitive multiset comparison of two attachment lists. */
export function sameSocialPostMedia(
  a: readonly SocialPostMediaRef[],
  b: readonly SocialPostMediaRef[],
): boolean {
  if (a.length !== b.length) return false;
  const counts = pathnameCounts(a);
  for (const ref of b) {
    const remaining = counts.get(ref.pathname);
    if (!remaining) return false;
    counts.set(ref.pathname, remaining - 1);
  }
  return true;
}

/** True when the same Drive file is already attached. */
export function hasSocialPostMedia(
  media: readonly SocialPostMediaRef[],
  pathname: string,
): boolean {
  return media.some((ref) => ref.pathname === pathname);
}
