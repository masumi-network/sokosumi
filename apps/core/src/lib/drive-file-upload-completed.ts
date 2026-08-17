import { z } from "@hono/zod-openapi";
import {
  clampDriveFileName,
  FILE_UPLOAD_MAX_SIZE_BYTES,
  isOwnedOrganizationDriveFileUrl,
  isOwnedUserDriveFileUrl,
  resolveUserUploadContentType,
} from "@sokosumi/utils";
import { del, head, type PutBlobResult } from "@vercel/blob";
import {
  isPrismaForeignKeyViolation,
  isPrismaUniqueViolation,
} from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

const driveFileUploadCompletedTokenPayloadSchema = z.object({
  scope: z.enum(["user", "organization"]),
  ownerId: z.string().min(1),
  name: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  /** Declared size used as the mint-time grant cap; not stored on DriveFile. */
  size: z.number().int().positive(),
  uploadedByUserId: z.string().min(1),
});

type DriveFileUploadCompletedTokenPayload = z.infer<
  typeof driveFileUploadCompletedTokenPayloadSchema
>;

/**
 * Client-fault failures for the Blob webhook handler (e.g. wrong callback type).
 * Map to HTTP 400 so Blob does not retry.
 */
export class DriveFileUploadClientError extends Error {
  readonly name = "DriveFileUploadClientError";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Create a `DriveFile` row after Blob confirms a successful client upload.
 * Size comes from Blob `head` (actual bytes), not the mint-time declaration.
 * Idempotent via unique `(userId, fileUrl)` or `(organizationId, fileUrl)` — concurrent webhook retries are safe.
 * Client-fault and gone-owner cases best-effort delete the orphan blob and soft-ack
 * (return) so Blob stops retrying.
 */
export async function registerDriveFileFromUploadCompleted(params: {
  blob: PutBlobResult;
  tokenPayload: string | null | undefined;
  blobToken: string;
}): Promise<void> {
  if (!params.tokenPayload) {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  let payload: DriveFileUploadCompletedTokenPayload;
  try {
    payload = driveFileUploadCompletedTokenPayloadSchema.parse(
      JSON.parse(params.tokenPayload),
    );
  } catch {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  // Validate URL ownership
  const isOwned =
    payload.scope === "user"
      ? isOwnedUserDriveFileUrl(params.blob.url, payload.ownerId)
      : isOwnedOrganizationDriveFileUrl(params.blob.url, payload.ownerId);

  if (!isOwned) {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  if (payload.size > FILE_UPLOAD_MAX_SIZE_BYTES) {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  const resolvedContentType = resolveUserUploadContentType(
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
    blobMetadata.size > FILE_UPLOAD_MAX_SIZE_BYTES ||
    blobMetadata.size > payload.size
  ) {
    await deleteOrphanBlob(params.blob.url, params.blobToken);
    return;
  }

  const displayName = clampDriveFileName(payload.name || "file");

  // Extract pathname from blob URL (before random suffix)
  const pathname =
    payload.scope === "user"
      ? `drive/users/${payload.ownerId}/${displayName}`
      : `drive/organizations/${payload.ownerId}/${displayName}`;

  try {
    await prisma.driveFile.create({
      data: {
        userId: payload.scope === "user" ? payload.ownerId : null,
        organizationId:
          payload.scope === "organization" ? payload.ownerId : null,
        uploadedByUserId: payload.uploadedByUserId,
        name: displayName,
        fileUrl: params.blob.url,
        pathname,
        mimeType: resolvedContentType,
        size: BigInt(blobMetadata.size),
      },
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      // Already registered (concurrent webhook retry)
      return;
    }

    if (isPrismaForeignKeyViolation(error)) {
      // Owner or uploader no longer exists
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
