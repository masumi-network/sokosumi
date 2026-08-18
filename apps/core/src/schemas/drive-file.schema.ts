import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/**
 * Drive file owner scope (personal or organization).
 */
export const driveFileScopeSchema = z.enum(["me", "org"]).openapi({
  example: "me",
  description:
    "Drive file owner scope: 'me' for personal, 'org' for organization",
});

export type DriveFileScope = z.infer<typeof driveFileScopeSchema>;

/**
 * Drive file upload session mint request.
 */
export const createDriveFileUploadSessionRequestSchema = z
  .object({
    filename: z.string().min(1).max(255).openapi({
      example: "report.pdf",
      description: "File name (becomes part of the blob pathname)",
    }),
    contentType: z.string().min(1).max(255).openapi({
      example: "application/pdf",
      description: "MIME type of the file",
    }),
    size: z.number().int().positive().openapi({
      example: 1024000,
      description: "File size in bytes",
    }),
    scope: driveFileScopeSchema.openapi({
      description:
        "Owner scope: 'me' for personal drive, 'org' for organization drive",
    }),
    organizationId: z.string().optional().openapi({
      example: "org_123",
      description: "Organization ID (required when scope=org)",
    }),
  })
  .openapi("CreateDriveFileUploadSessionRequest");

/**
 * Drive file upload session (presigned PUT grant).
 */
export const driveFileUploadSessionSchema = z
  .object({
    uploadUrl: z.string().url().openapi({
      example:
        "https://store.public.blob.vercel-storage.com/drive/users/user_123/report.pdf?vercel-blob-delegation=…",
      description: "Presigned Blob PUT URL (time-scoped, path-scoped)",
    }),
    pathname: z.string().openapi({
      example: "drive/users/user_123/report.pdf",
      description:
        "Server-generated upload pathname (no random suffix for Drive)",
    }),
    access: z.literal("public").openapi({
      example: "public",
      description: "Blob access level for the upload",
    }),
    method: z.literal("PUT").openapi({
      example: "PUT",
      description: "HTTP method for the client upload request",
    }),
    headers: z
      .object({
        "Content-Type": z.string().openapi({
          example: "application/pdf",
        }),
      })
      .openapi({
        description: "Headers the client must send on the PUT",
      }),
    expiresAt: z.string().datetime().openapi({
      example: "2026-08-18T12:00:00.000Z",
      description: "When the presigned upload URL expires (ISO-8601)",
    }),
    maxSizeBytes: z.number().int().positive().openapi({
      example: 104857600,
      description: "Maximum supported file size for this upload policy",
    }),
    addRandomSuffix: z.boolean().openapi({
      example: false,
      description: "Drive files use exact pathnames (no random suffix)",
    }),
  })
  .openapi("DriveFileUploadSession");

/**
 * Drive file API model (returned by GET, after upload completes).
 */
export const driveFileSchema = z
  .object({
    name: z.string().openapi({
      example: "report.pdf",
      description: "File name (extracted from pathname)",
    }),
    fileUrl: z.string().url().openapi({
      example:
        "https://store.public.blob.vercel-storage.com/drive/users/user_123/report.pdf",
      description: "Public Blob URL",
    }),
    pathname: z.string().openapi({
      example: "drive/users/user_123/report.pdf",
      description: "Blob pathname",
    }),
    size: z.number().int().openapi({
      example: 1024000,
      description: "File size in bytes",
    }),
    uploadedAt: dateTimeSchema.openapi({
      example: "2026-08-18T10:00:00.000Z",
      description: "When the file was uploaded to Blob storage",
    }),
  })
  .openapi("DriveFile");

export type DriveFile = z.infer<typeof driveFileSchema>;

/**
 * List of drive files.
 */
export const driveFilesSchema = z.array(driveFileSchema).openapi("DriveFiles");

/**
 * Rename drive file request.
 */
export const renameDriveFileRequestSchema = z
  .object({
    oldPathname: z.string().min(1).openapi({
      example: "drive/users/user_123/report.pdf",
      description: "Current blob pathname",
    }),
    newFilename: z.string().min(1).max(255).openapi({
      example: "renamed_report.pdf",
      description: "New file name (sanitized and used in new pathname)",
    }),
  })
  .openapi("RenameDriveFileRequest");

/**
 * Delete drive file request.
 */
export const deleteDriveFileRequestSchema = z
  .object({
    pathname: z.string().min(1).openapi({
      example: "drive/users/user_123/report.pdf",
      description: "Blob pathname to delete",
    }),
  })
  .openapi("DeleteDriveFileRequest");
