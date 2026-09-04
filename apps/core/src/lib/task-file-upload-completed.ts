import { z } from "@hono/zod-openapi";
import {
  clampTaskFileName,
  isOwnedTaskFileUrl,
  resolveTaskFileContentType,
  TASK_FILE_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import { del, head, type PutBlobResult } from "@vercel/blob";

import {
  isPrismaForeignKeyViolation,
  isPrismaUniqueViolation,
} from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

const taskFileUploadCompletedTokenPayloadSchema = z.object({
  taskId: z.string().min(1),
  name: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  /** Declared size used as the mint-time grant cap; not stored on TaskFile. */
  size: z.number().int().positive(),
  uploadedByUserId: z.string().min(1).nullable(),
  uploadedByCoworkerId: z.string().min(1).nullable(),
  uploadedBySokoBotId: z.uuid().nullable().optional().default(null),
});

type TaskFileUploadCompletedTokenPayload = z.infer<
  typeof taskFileUploadCompletedTokenPayloadSchema
>;

/**
 * Client-fault failures for the Blob webhook handler (e.g. wrong callback type).
 * Map to HTTP 400 so Blob does not retry.
 */
export class TaskFileUploadClientError extends Error {
  readonly name = "TaskFileUploadClientError";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Create a `TaskFile` row after Blob confirms a successful client upload.
 * Size comes from Blob `head` (actual bytes), not the mint-time declaration.
 * Idempotent via unique `(taskId, fileUrl)` — concurrent webhook retries are safe.
 * Client-fault and gone-task cases best-effort delete the orphan blob and soft-ack
 * (return) so Blob stops retrying.
 */
export async function registerTaskFileFromUploadCompleted(params: {
  blob: PutBlobResult;
  tokenPayload: string | null | undefined;
  blobToken: string;
}): Promise<void> {
  if (!params.tokenPayload) {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  let payload: TaskFileUploadCompletedTokenPayload;
  try {
    payload = taskFileUploadCompletedTokenPayloadSchema.parse(
      JSON.parse(params.tokenPayload),
    );
  } catch {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  if (!isOwnedTaskFileUrl(params.blob.url, payload.taskId)) {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  if (payload.size > TASK_FILE_MAX_SIZE_BYTES) {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  const resolvedContentType = resolveTaskFileContentType(
    payload.name,
    payload.mimeType,
  );
  if (!resolvedContentType) {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  const blobMetadata = await head(params.blob.url, {
    token: params.blobToken,
  });

  if (
    blobMetadata.size > TASK_FILE_MAX_SIZE_BYTES ||
    blobMetadata.size > payload.size
  ) {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  const displayName = clampTaskFileName(payload.name || "file");

  try {
    await prisma.taskFile.create({
      data: {
        taskId: payload.taskId,
        name: displayName,
        fileUrl: params.blob.url,
        mimeType: resolvedContentType,
        size: BigInt(blobMetadata.size),
        uploadedByUserId: payload.uploadedByUserId,
        uploadedByCoworkerId: payload.uploadedByCoworkerId,
        uploadedBySokoBotId: payload.uploadedBySokoBotId,
      },
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      return;
    }

    if (isPrismaForeignKeyViolation(error)) {
      await deleteOrphanBlob(params.blob.url, params.blobToken);
      return;
    }

    throw error;
  }
}

async function deleteOrphanBlob(url: string, token: string): Promise<void> {
  try {
    await del(url, { token });
  } catch {
    // Best-effort cleanup; soft-ack either way so Blob stops retrying.
  }
}
