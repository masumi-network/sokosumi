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

/**
 * Where every studio image and video lands in Files: one folder per Drive,
 * which Soko Bot, Social and newsletters attach from too.
 */
export const IMAGE_STUDIO_DRIVE_FOLDER = "Content Studio";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

/** `a-red-fox-3f2a9c1d.png`, so two images of one prompt never share a name. */
export function studioAssetFileName(
  prompt: string,
  jobId: string,
  contentType: string,
): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  const video = contentType.startsWith("video/");
  const extension = EXTENSIONS[contentType] ?? (video ? "mp4" : "png");
  return `${slug || (video ? "video" : "image")}-${jobId.slice(0, 8)}.${extension}`;
}

export interface StudioAssetDriveFile {
  id: string;
  name: string;
  pathname: string;
  mimeType: string;
  size: number;
}

/** The pathname a file named `name` has in a folder of the owner's Drive. */
export function ownerDrivePathname(input: {
  organizationId: string | null;
  userId: string;
  folder: string;
  name: string;
}): string {
  return input.organizationId
    ? buildOrganizationDriveFilePathnameWithFolder(
        input.organizationId,
        input.folder,
        input.name,
      )
    : buildUserDriveFilePathnameWithFolder(
        input.userId,
        input.folder,
        input.name,
      );
}

/**
 * Writes `bytes` as a Content Studio file in the owner's Drive, replacing a
 * file of the same name. Null when the file could not be activated.
 */
export async function writeStudioDriveFile(input: {
  workspaceId: string;
  organizationId: string | null;
  userId: string;
  name: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<(StudioAssetDriveFile & { url: string }) | null> {
  return writeOwnerDriveFile({
    ...input,
    pathname: ownerDrivePathname({
      ...input,
      folder: IMAGE_STUDIO_DRIVE_FOLDER,
    }),
  });
}

/**
 * Writes `bytes` at `pathname` in the owner's Drive, replacing what is there
 * (a re-upload keeps the file's id). Null when it could not be activated.
 */
export async function writeOwnerDriveFile(input: {
  workspaceId: string;
  organizationId: string | null;
  userId: string;
  pathname: string;
  name: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<(StudioAssetDriveFile & { url: string }) | null> {
  const { pathname, name, bytes, contentType } = input;
  const key = {
    workspaceId: input.workspaceId,
    scope: input.organizationId ? ("organization" as const) : ("user" as const),
    ownerId: input.organizationId ?? input.userId,
    pathname,
  };
  await reserveDriveUploadResource({
    key,
    displayName: name,
    mimeType: contentType,
    sizeBytes: bytes.byteLength,
  });
  const blob = await put(pathname, Buffer.from(bytes), {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  const activated = await activateDriveUploadResource({
    key,
    sizeBytes: bytes.byteLength,
    mimeType: contentType,
  });
  if (!activated) return null;
  nudgeFileIndexing();
  return {
    id: activated.resourceId,
    name,
    pathname,
    mimeType: contentType,
    size: bytes.byteLength,
    url: blob.url,
  };
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
  const pathname = ownerDrivePathname({
    ...input,
    folder: IMAGE_STUDIO_DRIVE_FOLDER,
    name,
  });
  const live = await prisma.fileResource.findUnique({
    where: {
      workspaceId_sourceKind_sourceScope_sourceId: {
        workspaceId: input.workspaceId,
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

  return writeStudioDriveFile({
    ...input,
    name,
    bytes: await readAssetBytes(asset.blobPathname),
    contentType: asset.contentType,
  });
}

/**
 * Put one delivered image or video into the Content Studio folder in Files.
 *
 * Best effort by design: the asset is already stored, paid for and visible in
 * the studio, so a failure here is logged and never fails settlement. The
 * name is keyed by the job, so a later attach reuses this file.
 */
export async function publishStudioAssetToFiles(input: {
  jobId: string;
  workspaceId: string;
  organizationId: string | null;
  userId: string;
  prompt: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<void> {
  try {
    await writeStudioDriveFile({
      ...input,
      name: studioAssetFileName(input.prompt, input.jobId, input.contentType),
    });
  } catch (error) {
    console.warn("[image-studio] could not add the asset to Files", {
      jobId: input.jobId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Names of the Task each project used to get as its studio "folder", before
 * studio files went to the Content Studio folder in Files.
 */
const LEGACY_FOLDER_TASK_NAMES = ["Content Studio Outputs", "Image generation"];
let legacyFolderTasksMoved = false;

/**
 * Moves the files of the old per-project folder Tasks into Content Studio in
 * Files and archives each Task once all its files are there. Runs from the
 * image-jobs sync a few Tasks at a time; once none are left it stops asking
 * until the next cold start.
 */
export async function moveLegacyStudioFolderTasks(
  limit: number,
): Promise<{ moved: number; failed: number }> {
  if (legacyFolderTasksMoved) return { moved: 0, failed: 0 };
  const tasks = await prisma.task.findMany({
    where: {
      name: { in: LEGACY_FOLDER_TASK_NAMES },
      projectId: { not: null },
      status: "COMPLETED",
      description: null,
      archivedAt: null,
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      workspaceId: true,
      organizationId: true,
      ownerId: true,
      creatorUserId: true,
      files: { select: { name: true, fileUrl: true, mimeType: true } },
    },
  });
  if (tasks.length === 0) legacyFolderTasksMoved = true;
  let moved = 0;
  let failed = 0;
  for (const task of tasks) {
    const userId = task.ownerId ?? task.creatorUserId;
    try {
      if (!userId) throw new Error("folder Task has no owner");
      for (const file of task.files) {
        if (!file.fileUrl) continue;
        const response = await fetch(file.fileUrl, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`download ${response.status}`);
        const written = await writeStudioDriveFile({
          workspaceId: task.workspaceId,
          organizationId: task.organizationId,
          userId,
          name: file.name,
          bytes: new Uint8Array(await response.arrayBuffer()),
          contentType:
            file.mimeType ??
            response.headers.get("content-type") ??
            "image/png",
        });
        if (!written) throw new Error(`could not save ${file.name}`);
      }
      await prisma.task.update({
        where: { id: task.id },
        data: { archivedAt: new Date() },
      });
      moved += 1;
    } catch (error) {
      failed += 1;
      // Bumped so the next tick tries the others first.
      await prisma.task.update({
        where: { id: task.id },
        data: { updatedAt: new Date() },
      });
      console.warn("[image-studio] could not move a folder Task to Files", {
        taskId: task.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { moved, failed };
}
