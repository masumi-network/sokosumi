import { z } from "@hono/zod-openapi";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";

/** The store a share request is about, as every Drive route takes it. */
const storeFields = {
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
};

/** Exactly one of a file (catalog id) or a folder (path in the store). */
const targetFields = {
  resourceId: z.string().uuid().optional().openapi({
    description: "Catalog id of the uploaded file to share.",
  }),
  folderPath: z.string().max(1_000).optional().openapi({
    description: 'Folder to share, e.g. "Masumi Fundraising".',
    example: "Masumi Fundraising",
  }),
};

export const driveShareQuerySchema = z.object({
  ...storeFields,
  ...targetFields,
});

export const upsertDriveShareRequestSchema = z
  .object({
    ...storeFields,
    ...targetFields,
    password: z
      .union([z.string().min(4).max(200), z.null()])
      .optional()
      .openapi({
        description:
          "Set or change the password; null removes it; omit to keep the current one.",
      }),
  })
  .openapi("UpsertDriveShareRequest");

export const driveShareSchema = z
  .object({
    id: z.string(),
    token: z.string(),
    kind: z.enum(["file", "folder"]),
    hasPassword: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("DriveShare");

export const driveShareResponseSchema = z
  .object({ share: z.union([driveShareSchema, z.null()]) })
  .openapi("DriveShareResponse");

const publicDriveShareItemSchema = z
  .object({
    path: z.string(),
    size: z.number().int(),
    uploadedAt: z.string(),
  })
  .openapi("PublicDriveShareItem");

export const publicDriveShareSchema = z
  .object({
    kind: z.enum(["file", "folder"]),
    name: z.string(),
    locked: z.boolean(),
    items: z.array(publicDriveShareItemSchema).optional(),
    truncated: z.boolean().optional(),
  })
  .openapi("PublicDriveShare");

export const unlockDriveShareRequestSchema = z
  .object({ password: z.string().min(1).max(200) })
  .openapi("UnlockDriveShareRequest");

export const unlockDriveShareResponseSchema = z
  .object({ proof: z.string() })
  .openapi("UnlockDriveShareResponse");

export const driveShareDownloadResponseSchema = z
  .object({ url: z.string().url() })
  .openapi("DriveShareDownload");

/** The unlock proof a public request carries, from the web's cookie. */
export const DRIVE_SHARE_UNLOCK_HEADER = "x-drive-share-unlock";

export function toDriveShareDto(share: {
  id: string;
  token: string;
  kind: "FILE" | "FOLDER";
  passwordHash: string | null;
  createdAt: Date;
}): z.infer<typeof driveShareSchema> {
  return {
    id: share.id,
    token: share.token,
    kind: share.kind === "FILE" ? "file" : "folder",
    hasPassword: share.passwordHash !== null,
    createdAt: share.createdAt.toISOString(),
  };
}
