import { FileSourceKind, FileSourceScope } from "@sokosumi/database";
import {
  buildOrganizationDriveFilePathnameWithFolder,
  buildUserDriveFilePathnameWithFolder,
} from "@sokosumi/utils";
import { put } from "@vercel/blob";

import prisma from "@/lib/db/prisma";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import {
  activateDriveUploadResource,
  reserveDriveUploadResource,
} from "@/services/file-catalog.service";
import { readAssetBytes } from "@/services/image-studio-assets.service";
import { studioAssetFileName } from "@/services/image-studio-files.service";

/** Drive folder Soko Bot and Social already attach studio images from. */
export const IMAGE_STUDIO_DRIVE_FOLDER = "Content Studio";

export interface StudioAssetDriveFile {
  id: string;
  name: string;
  pathname: string;
  mimeType: string;
  size: number;
}

/**
 * A ready studio image, copied once into the owner's Drive.
 *
 * Studio bytes live in a private store Social cannot attach. The copy is
 * keyed by the job, so asking again returns the same file.
 */
export async function ensureStudioAssetDriveFile(input: {
  projectId: string;
  assetId: string;
  workspaceId: string;
  organizationId: string | null;
  userId: string;
  prompt?: string;
  jobId?: string;
}): Promise<StudioAssetDriveFile | null> {
  const asset = await prisma.projectImageAsset.findFirst({
    where: { id: input.assetId, projectId: input.projectId },
    select: {
      blobPathname: true,
      contentType: true,
      prompt: true,
      jobId: true,
    },
  });
  if (!asset) return null;

  const prompt = input.prompt ?? asset.prompt;
  const jobId = input.jobId ?? asset.jobId;
  const name = studioAssetFileName(prompt, jobId, asset.contentType);
  const pathname = input.organizationId
    ? buildOrganizationDriveFilePathnameWithFolder(
        input.organizationId,
        IMAGE_STUDIO_DRIVE_FOLDER,
        name,
      )
    : buildUserDriveFilePathnameWithFolder(
        input.userId,
        IMAGE_STUDIO_DRIVE_FOLDER,
        name,
      );
  const key = {
    workspaceId: input.workspaceId,
    scope: input.organizationId ? ("organization" as const) : ("user" as const),
    ownerId: input.organizationId ?? input.userId,
    pathname,
  };

  const live = await prisma.fileResource.findUnique({
    where: {
      workspaceId_sourceKind_sourceScope_sourceId: {
        workspaceId: key.workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope: input.organizationId
          ? FileSourceScope.ORGANIZATION
          : FileSourceScope.USER,
        sourceId: pathname,
      },
    },
    select: {
      id: true,
      lifecycle: true,
      tombstonedAt: true,
      mimeType: true,
      sizeBytes: true,
    },
  });
  if (live?.lifecycle === "ACTIVE" && !live.tombstonedAt) {
    return {
      id: live.id,
      name,
      pathname,
      mimeType: live.mimeType ?? asset.contentType,
      size: live.sizeBytes ?? 0,
    };
  }

  const bytes = await readAssetBytes(asset.blobPathname);
  await reserveDriveUploadResource({
    key,
    displayName: name,
    mimeType: asset.contentType,
    sizeBytes: bytes.byteLength,
  });
  await put(pathname, Buffer.from(bytes), {
    access: "public",
    contentType: asset.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  const activated = await activateDriveUploadResource({
    key,
    sizeBytes: bytes.byteLength,
    mimeType: asset.contentType,
  });
  if (!activated) return null;
  nudgeFileIndexing();
  return {
    id: activated.resourceId,
    name,
    pathname,
    mimeType: asset.contentType,
    size: bytes.byteLength,
  };
}
