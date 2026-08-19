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
    folder: z.string().optional().openapi({
      example: "Projects/2026",
      description:
        "Target folder path relative to scope root (empty/omit for root)",
    }),
  })
  .refine(
    (data) => {
      if (data.scope === "org" && !data.organizationId) {
        return false;
      }
      return true;
    },
    {
      message: "organizationId is required when scope=org",
      path: ["organizationId"],
    },
  )
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

/**
 * Drive folder item (folder row in list result).
 */
export const driveFolderSchema = z
  .object({
    type: z.literal("folder").openapi({
      example: "folder",
      description: "Item type discriminator",
    }),
    name: z.string().openapi({
      example: "Documents",
      description: "Folder name (next path segment)",
    }),
    path: z.string().openapi({
      example: "Documents",
      description: "Relative folder path from current folder (single segment)",
    }),
  })
  .openapi("DriveFolder");

export type DriveFolder = z.infer<typeof driveFolderSchema>;

/**
 * Drive file item (file row in list result) with type discriminator.
 */
export const driveFileItemSchema = driveFileSchema
  .extend({
    type: z.literal("file").openapi({
      example: "file",
      description: "Item type discriminator",
    }),
  })
  .openapi("DriveFileItem");

export type DriveFileItem = z.infer<typeof driveFileItemSchema>;

/**
 * Drive list item (folder or file).
 */
export const driveItemSchema = z
  .discriminatedUnion("type", [driveFolderSchema, driveFileItemSchema])
  .openapi("DriveItem");

export type DriveItem = z.infer<typeof driveItemSchema>;

/**
 * List of drive items (folders and files).
 */
export const driveItemsSchema = z.array(driveItemSchema).openapi("DriveItems");

/**
 * Create folder request.
 */
export const createDriveFolderRequestSchema = z
  .object({
    folderPath: z.string().min(1).max(1000).openapi({
      example: "Projects/2026",
      description:
        "Folder path relative to scope root (may be nested with slashes)",
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
  .refine(
    (data) => {
      if (data.scope === "org" && !data.organizationId) {
        return false;
      }
      return true;
    },
    {
      message: "organizationId is required when scope=org",
      path: ["organizationId"],
    },
  )
  .openapi("CreateDriveFolderRequest");

/**
 * Rename folder request.
 */
export const renameDriveFolderRequestSchema = z
  .object({
    oldFolderPath: z.string().min(1).openapi({
      example: "Projects",
      description: "Current folder path relative to scope root",
    }),
    newFolderPath: z.string().min(1).max(1000).openapi({
      example: "ArchivedProjects",
      description: "New folder path relative to scope root",
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
  .refine(
    (data) => {
      if (data.scope === "org" && !data.organizationId) {
        return false;
      }
      return true;
    },
    {
      message: "organizationId is required when scope=org",
      path: ["organizationId"],
    },
  )
  .openapi("RenameDriveFolderRequest");

/**
 * Delete folder request.
 */
export const deleteDriveFolderRequestSchema = z
  .object({
    folderPath: z.string().min(1).openapi({
      example: "Projects/OldProject",
      description: "Folder path relative to scope root",
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
  .refine(
    (data) => {
      if (data.scope === "org" && !data.organizationId) {
        return false;
      }
      return true;
    },
    {
      message: "organizationId is required when scope=org",
      path: ["organizationId"],
    },
  )
  .openapi("DeleteDriveFolderRequest");

/**
 * Move file or folder request.
 */
export const moveDriveItemRequestSchema = z
  .object({
    sourcePathname: z.string().min(1).openapi({
      example: "drive/users/user_123/report.pdf",
      description:
        "Source pathname (file) or folder path relative to scope root (folder)",
    }),
    targetFolderPath: z.string().openapi({
      example: "Archive/2026",
      description:
        "Target folder path relative to scope root (empty string for root)",
    }),
    itemType: z.enum(["file", "folder"]).openapi({
      example: "file",
      description: "Type of item being moved",
    }),
    scope: driveFileScopeSchema.optional().openapi({
      description:
        "Owner scope (required for folder moves): 'me' for personal drive, 'org' for organization drive",
    }),
    organizationId: z.string().optional().openapi({
      example: "org_123",
      description: "Organization ID (required when scope=org for folder moves)",
    }),
  })
  .refine(
    (data) => {
      // For folder moves, scope is required
      if (data.itemType === "folder" && !data.scope) {
        return false;
      }
      // When scope=org, organizationId is required
      if (data.scope === "org" && !data.organizationId) {
        return false;
      }
      return true;
    },
    {
      message:
        "scope is required for folder moves; organizationId is required when scope=org",
    },
  )
  .openapi("MoveDriveItemRequest");
