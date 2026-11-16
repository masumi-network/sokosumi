import { FileSourceKind } from "@sokosumi/database";
import {
  type GoogleDisplayImageRole,
  socialPostMediaKindForMime,
} from "@sokosumi/utils";
import { head } from "@vercel/blob";
import { GOOGLE_DISPLAY_IMAGE_MIME_TYPES } from "@/lib/ads/campaigns";
import { fitDisplayImage } from "@/lib/ads/display-image-fit";
import { isInDataRoom, publicDriveUrl } from "@/lib/drive-blob";
import { downloadBlob } from "@/services/file-index.service";
import { loadLiveResources } from "@/services/file-search.service";
import { writeStudioDriveFile } from "@/services/image-studio-drive.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { dataRoomRefusal } from "./drive-reading";
import { type SocialMediaInput, type SocialMediaRef } from "./media-models";
import { type RuntimeOperations } from "./operations";

/**
 * Social media given as `{ fileId }` becomes the Drive reference the Social
 * service stores. The bot never sees a file's storage address, so without
 * this it could not attach any file at all.
 */
export async function resolveSocialMedia(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  media: readonly SocialMediaInput[] | undefined,
): Promise<SocialMediaRef[] | undefined> {
  if (!media) return undefined;
  const ids = media.flatMap((item) => ("fileId" in item ? [item.fileId] : []));
  if (ids.length === 0) return media as SocialMediaRef[];
  const drive = await runtime.ownerDrive(authorized);
  const files = await loadLiveResources({
    workspaceId: drive.key.workspaceId,
    actor: drive.actor,
    resourceIds: ids,
  });
  return Promise.all(
    media.map(async (item) => {
      if (!("fileId" in item)) return item;
      const file = files.find((candidate) => candidate.id === item.fileId);
      if (!file || file.sourceKind !== FileSourceKind.DRIVE_UPLOAD)
        throw new SokoBotRuntimeValidationError(
          `File ${item.fileId} is not in the owner's Files; use an id from list_files, get_image or get_video`,
        );
      const mimeType = file.mimeType ?? "";
      const kind = socialPostMediaKindForMime(mimeType);
      if (!kind)
        throw new SokoBotRuntimeValidationError(
          `"${file.displayName}" is not an image or video a Social post can carry`,
        );
      const fileUrl = await publicDriveUrl(file.sourceId);
      if (!fileUrl)
        throw new SokoBotRuntimeValidationError(
          dataRoomRefusal(file.displayName),
        );
      return {
        pathname: file.sourceId,
        fileUrl,
        name: file.displayName,
        size: file.sizeBytes ?? 0,
        mimeType,
        kind,
      };
    }),
  );
}

/**
 * A Display campaign's images given as `{ fileId, role }` become the Drive
 * references the ads service stores. Google takes JPEG, PNG and GIF only
 * and refuses a ratio more than 1% off the role's, so an image that does
 * not fit is centre-cropped to it into a new image in Content Studio.
 */
export async function resolveAdImages(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  images: readonly { fileId: string; role: GoogleDisplayImageRole }[],
) {
  const drive = await runtime.ownerDrive(authorized);
  const files = await loadLiveResources({
    workspaceId: drive.key.workspaceId,
    actor: drive.actor,
    resourceIds: images.map(({ fileId }) => fileId),
  });
  return Promise.all(
    images.map(async ({ fileId, role }) => {
      const file = files.find((candidate) => candidate.id === fileId);
      if (!file || file.sourceKind !== FileSourceKind.DRIVE_UPLOAD)
        throw new SokoBotRefusedUnsentError(
          `File ${fileId} is not in the owner's Files; use an id from list_files, get_image or upload_file`,
        );
      const mimeType = file.mimeType ?? "";
      if (
        !GOOGLE_DISPLAY_IMAGE_MIME_TYPES.some((m) => m === mimeType) &&
        mimeType !== "image/webp"
      )
        throw new SokoBotRefusedUnsentError(
          `"${file.displayName}" is not a JPEG, PNG, GIF or WebP image`,
        );
      if (await isInDataRoom(file.sourceId))
        throw new SokoBotRefusedUnsentError(dataRoomRefusal(file.displayName));
      const bytes = await downloadBlob(file.sourceId);
      if (!bytes)
        throw new SokoBotRefusedUnsentError(
          `"${file.displayName}" could not be read; try again`,
        );
      const fit = await fitDisplayImage(bytes, mimeType, role);
      if (fit.kind === "refused")
        throw new SokoBotRefusedUnsentError(
          `"${file.displayName}": ${fit.reason}`,
        );
      if (fit.kind === "unchanged")
        return {
          pathname: file.sourceId,
          fileUrl: (await head(file.sourceId)).url,
          name: file.displayName,
          size: file.sizeBytes ?? 0,
          mimeType: fit.mimeType,
          role,
        };
      const cropped = await writeStudioDriveFile({
        workspaceId: drive.key.workspaceId,
        organizationId:
          drive.key.scope === "organization" ? drive.key.ownerId : null,
        userId: drive.actor.userId,
        // The source id's random tail keeps two sources with one name apart.
        name: `${file.displayName.replace(/\.[^.]*$/, "")}-${role.toLowerCase()}-${fileId.slice(-8)}.jpg`,
        bytes: fit.bytes,
        contentType: "image/jpeg",
      });
      if (!cropped)
        throw new SokoBotRefusedUnsentError(
          `"${file.displayName}" could not be saved after cropping; try again`,
        );
      return {
        pathname: cropped.pathname,
        fileUrl: cropped.url,
        name: cropped.name,
        size: cropped.size,
        mimeType: "image/jpeg" as const,
        role,
      };
    }),
  );
}

/**
 * The post's media and each thread part's media, resolved in one Drive
 * lookup so a long thread with images does not read the Drive per part.
 */
export async function resolveSocialPostMedia(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  input: {
    media?: SocialMediaInput[];
    threadParts?: { text: string; media?: SocialMediaInput[] }[];
  },
): Promise<{
  media: SocialMediaRef[] | undefined;
  threadParts: { text: string; media?: SocialMediaRef[] }[] | undefined;
}> {
  const groups = [
    input.media,
    ...(input.threadParts ?? []).map((part) => part.media),
  ];
  const resolved =
    (await runtime.resolveSocialMedia(
      authorized,
      groups.flatMap((group) => group ?? []),
    )) ?? [];
  let offset = 0;
  const [media, ...partMedia] = groups.map((group) => {
    if (!group) return undefined;
    offset += group.length;
    return resolved.slice(offset - group.length, offset);
  });
  return {
    media,
    threadParts: input.threadParts?.map((part, index) => ({
      text: part.text,
      media: partMedia[index],
    })),
  };
}
