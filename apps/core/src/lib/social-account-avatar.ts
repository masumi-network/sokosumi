import * as Sentry from "@sentry/node";
import {
  buildSocialAccountAvatarPathname,
  isOwnedSocialAccountAvatarUrl,
  isSocialAccountAvatarAllowedContentType,
  SOCIAL_ACCOUNT_AVATAR_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import { del, put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { attachUploadToLogger } from "@/lib/evlog";
import { downloadRemoteImage } from "@/lib/remote-image";

const DOWNLOAD_TIMEOUT_MS = 5_000;

export interface SnapshotSocialAccountAvatarParams {
  projectId: string;
  provider: string;
  externalAccountId: string;
  avatarUrl: string;
}

/**
 * Copy a connected account's profile picture into Vercel Blob. Provider CDN
 * URLs (Instagram, Facebook, LinkedIn) expire, so previews read our copy.
 * Returns null on any failure: an avatar never blocks a connection.
 */
export async function snapshotSocialAccountAvatar(
  params: SnapshotSocialAccountAvatarParams,
): Promise<string | null> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return null;

  const image = await downloadRemoteImage(params.avatarUrl, {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxBytes: SOCIAL_ACCOUNT_AVATAR_MAX_SIZE_BYTES,
    isAllowedContentType: isSocialAccountAvatarAllowedContentType,
  });
  if (!image) return null;

  const pathname = buildSocialAccountAvatarPathname(
    params.projectId,
    params.provider,
    params.externalAccountId,
    image.contentType,
  );
  try {
    attachUploadToLogger({
      filename: pathname.split("/").pop() || pathname,
      size: image.bytes.byteLength,
      mimeType: image.contentType,
    });
    const stored = await put(pathname, image.bytes, {
      access: "public",
      contentType: image.contentType,
      token,
      addRandomSuffix: true,
    });
    return stored.url;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { function: "snapshotSocialAccountAvatar" },
      extra: { projectId: params.projectId, provider: params.provider },
    });
    return null;
  }
}

/** Best-effort delete of a replaced avatar this Project owns. */
export async function deleteSocialAccountAvatarIfOwned(
  url: string | null,
  projectId: string,
): Promise<void> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token || !url || !isOwnedSocialAccountAvatarUrl(url, projectId)) return;
  try {
    await del(url, { token });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { function: "deleteSocialAccountAvatarIfOwned" },
      extra: { projectId },
    });
  }
}
