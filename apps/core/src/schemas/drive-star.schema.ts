import { z } from "@hono/zod-openapi";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import { fileResourceSchema } from "@/schemas/file-resource.schema";

const storeFields = {
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
};

export const driveStarsQuerySchema = z.object(storeFields);

export const setDriveStarRequestSchema = z
  .object({
    ...storeFields,
    resourceId: z.string().uuid().optional().openapi({
      description: "Catalog id of the file to star or unstar.",
    }),
    folderPath: z.string().max(1_000).optional().openapi({
      description: 'Folder to star or unstar, e.g. "Finance/Board".',
      example: "Finance/Board",
    }),
    starred: z.boolean(),
  })
  .openapi("SetDriveStarRequest");

export const driveStarsSchema = z
  .object({
    folders: z.array(
      z.object({
        path: z.string().openapi({ example: "Finance/Board" }),
        name: z.string().openapi({ example: "Board" }),
      }),
    ),
    files: z.array(fileResourceSchema),
  })
  .openapi("DriveStars");
