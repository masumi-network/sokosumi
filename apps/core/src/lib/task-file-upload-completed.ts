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

export const taskFileUploadCompletedTokenPayloadSchema = z.object({
  taskId: z.string().min(1),
  name: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  /** Declared size used as the mint-time grant cap; not stored on TaskFile. */
  size: z.number().int().positive(),
  uploadedByUserId: z.string().min(1).nullable(),
  uploadedByCoworkerId: z.string().min(1).nullable(),
});

export type TaskFileUploadCompletedTokenPayload = z.infer<
  typeof taskFileUploadCompletedTokenPayloadSchema
>;

/** Validation / client-fault failures — map to HTTP 400 (do not retry). */
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
 * If the task (FK) is gone, best-effort deletes the orphan blob and soft-acks.
 */
export async function registerTaskFileFromUploadCompleted(params: {
  blob: PutBlobResult;
  tokenPayload: string | null | undefined;
  blobToken: string;
}): Promise<void> {
  if (!params.tokenPayload) {
    throw new TaskFileUploadClientError(
      "Missing tokenPayload on task file upload completion",
    );
  }

  let payload: TaskFileUploadCompletedTokenPayload;
  try {
    payload = taskFileUploadCompletedTokenPayloadSchema.parse(
      JSON.parse(params.tokenPayload),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid tokenPayload";
    throw new TaskFileUploadClientError(message);
  }

  if (!isOwnedTaskFileUrl(params.blob.url, payload.taskId)) {
    throw new TaskFileUploadClientError(
      "Completed blob URL is not under the expected task file prefix",
    );
  }

  if (payload.size > TASK_FILE_MAX_SIZE_BYTES) {
    throw new TaskFileUploadClientError(
      `File is too large. Maximum size is ${TASK_FILE_MAX_SIZE_BYTES} bytes.`,
    );
  }

  const resolvedContentType = resolveTaskFileContentType(
    payload.name,
    payload.mimeType,
  );
  if (!resolvedContentType) {
    throw new TaskFileUploadClientError(
      "Unsupported content type for task file",
    );
  }

  const blobMetadata = await head(params.blob.url, {
    token: params.blobToken,
  });

  if (blobMetadata.size > TASK_FILE_MAX_SIZE_BYTES) {
    throw new TaskFileUploadClientError(
      `File is too large. Maximum size is ${TASK_FILE_MAX_SIZE_BYTES} bytes.`,
    );
  }

  // Grant was capped at the declared size; actual bytes must not exceed it.
  if (blobMetadata.size > payload.size) {
    throw new TaskFileUploadClientError(
      "Uploaded blob exceeds the declared mint size",
    );
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
