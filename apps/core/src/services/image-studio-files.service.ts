import { Channel, TaskFileOrigin, TaskStatus } from "@sokosumi/database";
import { buildTaskFilePathname } from "@sokosumi/utils";
import { put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

/**
 * Where a studio image shows up in Files: Tasks > project > "Content Studio Outputs".
 *
 * Files' Tasks view is Task -> TaskFile, so the folder is one Task per project
 * and each image is one of its output files. That Task is a bucket, not work:
 * it is created already COMPLETED and nothing ever runs it.
 *
 * Task files are public Blob URLs, like every other task output, so this
 * publishes a copy next to the private original. The private store stays the
 * source of truth for the studio itself.
 */
export const IMAGE_GENERATION_FOLDER_NAME = "Content Studio Outputs";
/**
 * The folder's old name. Existing projects already hold a Task with it, so the
 * lookup still finds it (no second folder) and renames it on next use.
 */
export const LEGACY_IMAGE_GENERATION_FOLDER_NAME = "Image generation";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** `a-red-fox-3f2a9c1d.png`, so two images of one prompt never share a name. */
export function imageFileName(
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
  return `${slug || "image"}-${jobId.slice(0, 8)}.${EXTENSIONS[contentType] ?? "png"}`;
}

/** The project's "Content Studio Outputs" Task, created on first use. */
export async function folderTaskId(input: {
  projectId: string;
  workspaceId: string;
  organizationId: string | null;
  userId: string;
}): Promise<string> {
  return await prisma.$transaction(async (tx) => {
    // Two images settling together must not each create the folder.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`image-generation:${input.projectId}`}))`;
    const existing = await tx.task.findFirst({
      where: {
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        name: {
          in: [
            IMAGE_GENERATION_FOLDER_NAME,
            LEGACY_IMAGE_GENERATION_FOLDER_NAME,
          ],
        },
        archivedAt: null,
      },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      if (existing.name !== IMAGE_GENERATION_FOLDER_NAME) {
        await tx.task.update({
          where: { id: existing.id },
          data: { name: IMAGE_GENERATION_FOLDER_NAME },
        });
      }
      return existing.id;
    }
    const created = await tx.task.create({
      data: {
        ownerId: input.userId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        name: IMAGE_GENERATION_FOLDER_NAME,
        status: TaskStatus.COMPLETED,
        creatorUserId: input.userId,
        events: {
          create: {
            status: TaskStatus.COMPLETED,
            channel: Channel.SOKOSUMI,
            userId: input.userId,
          },
        },
      },
      select: { id: true },
    });
    return created.id;
  });
}

/**
 * Put one delivered image into Files.
 *
 * Best effort by design: the image is already stored, paid for and visible in
 * the studio, so a failure here is logged and never fails settlement.
 * ponytail: no retry, so an image that fails here is missing from Files until
 * a backfill exists.
 */
export async function publishImageToFiles(input: {
  jobId: string;
  projectId: string;
  workspaceId: string;
  organizationId: string | null;
  userId: string;
  prompt: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<void> {
  try {
    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
    const taskId = await folderTaskId(input);
    const name = imageFileName(input.prompt, input.jobId, input.contentType);
    const blob = await put(
      buildTaskFilePathname(taskId, name),
      input.bytes as unknown as Buffer,
      {
        access: "public",
        contentType: input.contentType,
        token,
        addRandomSuffix: true,
        abortSignal: AbortSignal.timeout(60_000),
      },
    );
    await prisma.taskFile.create({
      data: {
        taskId,
        name,
        fileUrl: blob.url,
        mimeType: input.contentType,
        size: BigInt(input.bytes.byteLength),
        origin: TaskFileOrigin.TASK_OUTPUT,
        uploadedByUserId: input.userId,
      },
    });
  } catch (error) {
    console.warn("[image-studio] could not add the image to Files", {
      jobId: input.jobId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
