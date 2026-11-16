import { z } from "@hono/zod-openapi";
import {
  clampTaskFileName,
  isOwnedTaskFileUrl,
  resolveTaskFileContentType,
  TASK_FILE_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import { del, head, type PutBlobResult } from "@vercel/blob";
import { HTTPException } from "hono/http-exception";

import type { HTTPExceptionMetadata } from "@/helpers/error";

import {
  isPrismaForeignKeyViolation,
  isPrismaUniqueViolation,
} from "@/helpers/prisma";
import { requireTaskWorkerContext } from "@/helpers/task-worker-context";
import prisma from "@/lib/db/prisma";
import {
  CONCURRENCY_CONFLICT_KIND,
  serializableTransaction,
} from "@/lib/db/transaction";
import { taskFileWorkerBindingSchema } from "@/schemas/task-worker-context.schema";
import { reconcileProjectSeoTaskFile } from "@/services/project-seo-import.service";

const taskFileUploadCompletedTokenPayloadSchema = z
  .object({
    taskId: z.string().min(1),
    name: z.string().min(1).max(512),
    mimeType: z.string().min(1).max(255),
    /** Declared size used as the mint-time grant cap; not stored on TaskFile. */
    size: z.number().int().positive(),
    uploadedByUserId: z.string().min(1).nullable(),
    uploadedByCoworkerId: z.string().min(1).nullable(),
    uploadedBySokoBotId: z.uuid().nullable().optional(),
    contextBinding: taskFileWorkerBindingSchema.optional(),
  })
  .transform((payload) => ({
    taskId: payload.taskId,
    name: payload.name,
    mimeType: payload.mimeType,
    size: payload.size,
    uploadedByUserId: payload.uploadedByUserId,
    uploadedByCoworkerId: payload.uploadedByCoworkerId,
    uploadedBySokoBotId: payload.uploadedBySokoBotId ?? null,
    contextBinding: payload.contextBinding,
  }));

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
  contextBound?: boolean;
}): Promise<void> {
  if (!params.tokenPayload) {
    if (params.contextBound)
      throw new TaskFileUploadClientError("A signed Task context is required");
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  let payload: TaskFileUploadCompletedTokenPayload;
  let hasContextBinding = false;
  try {
    const raw: unknown = JSON.parse(params.tokenPayload);
    hasContextBinding =
      typeof raw === "object" && raw !== null && "contextBinding" in raw;
    payload = taskFileUploadCompletedTokenPayloadSchema.parse(raw);
  } catch {
    if (params.contextBound || hasContextBinding)
      throw new TaskFileUploadClientError("Invalid signed Task upload context");
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  // A guarded grant may only use its versioned callback. Never downgrade it.
  if (Boolean(params.contextBound) !== Boolean(payload.contextBinding)) {
    throw new TaskFileUploadClientError(
      "Upload callback context version does not match its grant",
    );
  }

  if (payload.contextBinding) {
    const existing = await prisma.taskFile.findUnique({
      where: {
        taskId_fileUrl: { taskId: payload.taskId, fileUrl: params.blob.url },
      },
      select: { id: true },
    });
    // A retry after a Task move must retain history and resume a failed import.
    if (existing) {
      await reconcileProjectSeoTaskFile(payload.taskId, existing.id);
      return;
    }
    if (
      payload.uploadedByCoworkerId !== payload.contextBinding.coworkerId ||
      payload.uploadedByUserId !== null ||
      payload.uploadedBySokoBotId !== null
    ) {
      await deleteOrphanBlob(params.blob.url, params.blobToken);
      return;
    }
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
  const isSeoReport =
    !!payload.uploadedByCoworkerId &&
    displayName === `seo-report-${payload.taskId}.json` &&
    resolvedContentType === "application/json";

  let taskFileId: string;
  try {
    const data = {
      taskId: payload.taskId,
      name: displayName,
      fileUrl: params.blob.url,
      mimeType: resolvedContentType,
      size: BigInt(blobMetadata.size),
      uploadedByUserId: payload.uploadedByUserId,
      uploadedByCoworkerId: payload.uploadedByCoworkerId,
      uploadedBySokoBotId: payload.uploadedBySokoBotId,
    };
    const binding = payload.contextBinding;
    const taskFile = binding
      ? await serializableTransaction(async (tx) => {
          await requireTaskWorkerContext(
            {
              actor: "coworker",
              coworkerId: binding.coworkerId,
              vendorId: binding.vendorId,
            },
            payload.taskId,
            binding.expectedContext,
            tx,
          );
          return tx.taskFile.create({ data });
        }, "Task changed during upload completion. Please retry.")
      : await prisma.taskFile.create({ data });
    taskFileId = isSeoReport ? taskFile.id : "";
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      if (!isSeoReport) return;
      const taskFile = await prisma.taskFile.findUnique({
        where: {
          taskId_fileUrl: { taskId: payload.taskId, fileUrl: params.blob.url },
        },
        select: { id: true },
      });
      if (!taskFile) return;
      taskFileId = taskFile.id;
    } else {
      if (
        payload.contextBinding &&
        error instanceof HTTPException &&
        [403, 404, 409].includes(error.status) &&
        (error.cause as HTTPExceptionMetadata | undefined)?.kind !==
          CONCURRENCY_CONFLICT_KIND
      ) {
        // Do not delete here: a later valid callback may link the same Blob
        // after the Task moves back. Retain it for separate storage cleanup.
        return;
      }
      if (isPrismaForeignKeyViolation(error)) {
        await deleteOrphanBlob(params.blob.url, params.blobToken);
        return;
      }
      throw error;
    }
  }
  if (isSeoReport)
    await reconcileProjectSeoTaskFile(payload.taskId, taskFileId);
}

async function deleteOrphanBlob(url: string, token: string): Promise<void> {
  try {
    await del(url, { token });
  } catch {
    // Best-effort cleanup; soft-ack either way so Blob stops retrying.
  }
}
