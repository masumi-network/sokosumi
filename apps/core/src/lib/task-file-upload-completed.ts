import { z } from "@hono/zod-openapi";
import {
  clampTaskFileName,
  isOwnedTaskFileUrl,
  resolveTaskFileContentType,
  TASK_FILE_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import type { PutBlobResult } from "@vercel/blob";

import prisma from "@/lib/db/prisma";

export const taskFileUploadCompletedTokenPayloadSchema = z.object({
  taskId: z.string().min(1),
  name: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().positive(),
  uploadedByUserId: z.string().min(1).nullable(),
  uploadedByCoworkerId: z.string().min(1).nullable(),
});

export type TaskFileUploadCompletedTokenPayload = z.infer<
  typeof taskFileUploadCompletedTokenPayloadSchema
>;

/**
 * Create a `TaskFile` row after Blob confirms a successful client upload.
 * Idempotent on `fileUrl` so Blob webhook retries do not duplicate rows.
 */
export async function registerTaskFileFromUploadCompleted(params: {
  blob: PutBlobResult;
  tokenPayload: string | null | undefined;
}): Promise<void> {
  if (!params.tokenPayload) {
    throw new Error("Missing tokenPayload on task file upload completion");
  }

  const payload = taskFileUploadCompletedTokenPayloadSchema.parse(
    JSON.parse(params.tokenPayload),
  );

  if (!isOwnedTaskFileUrl(params.blob.url, payload.taskId)) {
    throw new Error(
      "Completed blob URL is not under the expected task file prefix",
    );
  }

  if (payload.size > TASK_FILE_MAX_SIZE_BYTES) {
    throw new Error(
      `File is too large. Maximum size is ${TASK_FILE_MAX_SIZE_BYTES} bytes.`,
    );
  }

  const resolvedContentType = resolveTaskFileContentType(
    payload.name,
    payload.mimeType,
  );
  if (!resolvedContentType) {
    throw new Error("Unsupported content type for task file");
  }

  const displayName = clampTaskFileName(payload.name || "file");

  const existing = await prisma.taskFile.findFirst({
    where: {
      taskId: payload.taskId,
      fileUrl: params.blob.url,
    },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  await prisma.taskFile.create({
    data: {
      taskId: payload.taskId,
      name: displayName,
      fileUrl: params.blob.url,
      mimeType: resolvedContentType,
      size: BigInt(payload.size),
      uploadedByUserId: payload.uploadedByUserId,
      uploadedByCoworkerId: payload.uploadedByCoworkerId,
    },
  });
}
