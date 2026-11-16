import { createHash } from "node:crypto";
import {
  type SocialPostMediaRef,
  type SocialPostProvider,
  socialPostMaxBytesForKind,
  socialPostMediaKindForMime,
  socialPostProviderLabel,
} from "@sokosumi/utils";

import {
  DriveFileDownloadError,
  downloadDriveFile,
} from "@/helpers/drive-file-download";
import { requireWorkspaceDriveFileUrl } from "@/helpers/drive-file-ref";
import { badRequest, conflict } from "@/helpers/error";
import { prepareSocialPostImage } from "@/helpers/social-post-image";
import { writeStudioDriveFile } from "@/services/image-studio-drive.service";

const PREPARATION_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
const preparedProviders = new WeakMap<
  readonly SocialPostMediaRef[],
  SocialPostProvider
>();

interface MediaPreparationScope {
  workspaceId: string;
  organizationId: string | null;
  userId: string;
}

/** A connection changed during preparation; retry before storing a variant for the wrong network. */
export function requirePreparedSocialPostProvider(
  media: readonly SocialPostMediaRef[],
  provider: SocialPostProvider,
): void {
  const preparedProvider = preparedProviders.get(media);
  if (preparedProvider && preparedProvider !== provider)
    throw conflict(
      "The social account changed while preparing the image; try again",
    );
}

/** Prepares copies before a write transaction; every original remains untouched in Drive. */
export async function prepareSocialPostMedia(
  scope: MediaPreparationScope,
  provider: SocialPostProvider,
  media: readonly SocialPostMediaRef[],
): Promise<SocialPostMediaRef[]> {
  const prepared: SocialPostMediaRef[] = [];
  for (const ref of media) {
    requireWorkspaceDriveFileUrl(scope, ref);
    const original = ref.transformation?.original ?? ref;
    const fileUrl = requireWorkspaceDriveFileUrl(scope, original);
    const source: SocialPostMediaRef = {
      pathname: original.pathname,
      fileUrl,
      name: original.name,
      size: original.size,
      mimeType: original.mimeType.trim().toLowerCase(),
      kind: original.kind,
    };
    if (socialPostMediaKindForMime(source.mimeType) !== source.kind)
      throw badRequest(
        `Media file "${source.name}" is not a file type ${socialPostProviderLabel(provider)} accepts`,
      );
    if (
      source.kind !== "image" ||
      (provider !== "instagram" &&
        provider !== "linkedin" &&
        (provider !== "x" ||
          source.size <= socialPostMaxBytesForKind(provider, "image")))
    ) {
      prepared.push(source);
      continue;
    }
    const downloaded = await downloadDriveFile(source.fileUrl, {
      maxBytes: PREPARATION_DOWNLOAD_MAX_BYTES,
      timeoutMs: 60_000,
      acceptsMimeType: (mimeType) =>
        ["image/jpeg", "image/png", "image/webp"].includes(mimeType),
    }).catch((error: unknown) => {
      if (!(error instanceof DriveFileDownloadError)) throw error;
      const reason =
        error.reason === "unavailable"
          ? "is no longer available"
          : error.reason === "too_large"
            ? "is too large to prepare"
            : "is not a supported still image";
      throw badRequest(
        `Media file "${source.name}" ${reason}; choose another image and try again`,
      );
    });
    const result = await prepareSocialPostImage(
      provider,
      downloaded.bytes,
      downloaded.mimeType,
    );
    if (!result.notice || !result.code) {
      prepared.push(source);
      continue;
    }
    const transformation = {
      provider,
      code: result.code,
      notice: result.notice,
      original: source,
    };
    if (result.bytes === downloaded.bytes) {
      prepared.push({ ...source, transformation });
      continue;
    }
    const hash = createHash("sha256")
      .update(result.bytes)
      .digest("hex")
      .slice(0, 16);
    const name = `${source.name.replace(/\.[^.]*$/, "")}-${provider}-${hash}.${result.mimeType === "image/png" ? "png" : "jpg"}`;
    const file = await writeStudioDriveFile({
      ...scope,
      name,
      bytes: result.bytes,
      contentType: result.mimeType,
    });
    if (!file)
      throw badRequest(
        `The adapted image "${source.name}" could not be saved; try again`,
      );
    prepared.push({
      pathname: file.pathname,
      fileUrl: file.url,
      name: file.name,
      size: file.size,
      mimeType: result.mimeType,
      kind: "image",
      transformation,
    });
  }
  preparedProviders.set(prepared, provider);
  return prepared;
}
