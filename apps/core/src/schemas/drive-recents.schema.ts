import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

export const driveRecentsDriveFileItemSchema = z
  .object({
    kind: z.literal("drive-file").openapi({
      example: "drive-file",
      description: "Drive blob file at any folder depth",
    }),
    name: z.string().openapi({
      example: "report.pdf",
      description: "File name",
    }),
    fileUrl: z.string().url().openapi({
      example: "https://store.public.blob.vercel-storage.com/drive/users/...",
      description: "Blob URL",
    }),
    pathname: z.string().openapi({
      example: "drive/users/user_123/Projects/report.pdf",
      description: "Blob pathname",
    }),
    size: z.number().int().openapi({
      example: 1024,
      description: "File size in bytes",
    }),
    activityAt: dateTimeSchema.openapi({
      example: "2026-08-18T10:00:00.000Z",
      description: "Latest activity timestamp (blob uploadedAt)",
    }),
  })
  .openapi("DriveRecentsDriveFileItem");

export const driveRecentsTaskOutputItemSchema = z
  .object({
    kind: z.literal("task-output").openapi({
      example: "task-output",
      description: "READY TASK_OUTPUT TaskFile row",
    }),
    name: z.string().openapi({
      example: "mockup-v2.pdf",
      description: "TaskFile name",
    }),
    fileUrl: z.string().url().openapi({
      example: "https://store.public.blob.vercel-storage.com/tasks/...",
      description: "TaskFile blob URL",
    }),
    size: z.number().int().nullable().openapi({
      example: 1024000,
      description: "File size in bytes (null if unknown)",
    }),
    activityAt: dateTimeSchema.openapi({
      example: "2026-08-18T10:00:00.000Z",
      description: "Latest activity timestamp (TaskFile updatedAt)",
    }),
    taskFileId: z.string().openapi({
      example: "tf_123",
      description: "TaskFile ID",
    }),
    taskId: z.string().openapi({
      example: "tsk_xyz789",
      description: "Parent task ID",
    }),
    taskName: z.string().openapi({
      example: "Design mockups",
      description: "Parent task name",
    }),
    projectId: z.string().nullable().openapi({
      example: "prj_abc123",
      description: "Parent project ID, or null",
    }),
    projectName: z.string().nullable().openapi({
      example: "Q4 Campaign",
      description: "Parent project name, or null",
    }),
  })
  .openapi("DriveRecentsTaskOutputItem");

export const driveRecentsItemSchema = z
  .discriminatedUnion("kind", [
    driveRecentsDriveFileItemSchema,
    driveRecentsTaskOutputItemSchema,
  ])
  .openapi("DriveRecentsItem");

export type DriveRecentsItem = z.infer<typeof driveRecentsItemSchema>;

export const driveRecentsListSchema = z
  .array(driveRecentsItemSchema)
  .openapi("DriveRecentsList");

export const driveRecentsQuerySchema = z
  .object({
    scope: driveFileScopeSchema.openapi({
      param: { name: "scope", in: "query" },
      description: "Drive scope: 'me' for personal, 'org' for organization",
    }),
    organizationId: z
      .string()
      .optional()
      .openapi({
        param: { name: "organizationId", in: "query" },
        example: "org_123",
        description: "Organization ID (required when scope=org)",
      }),
    q: z
      .string()
      .optional()
      .openapi({
        param: { name: "q", in: "query" },
        example: "report",
        description:
          "Search recents by file name (Drive blobs) or task/file name and task description (task outputs). Case-insensitive substring.",
      }),
  })
  .merge(cursorPaginationQuerySchema)
  .refine((data) => data.scope !== "org" || Boolean(data.organizationId), {
    message: "organizationId is required when scope=org",
    path: ["organizationId"],
  });
