import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";

/**
 * Drive Tasks list item - discriminated union by level.
 */
export const driveTasksProjectItemSchema = z
  .object({
    type: z.literal("project").openapi({
      example: "project",
      description: "Project row with at least one task file",
    }),
    id: z.string().openapi({
      example: "prj_abc123",
      description: "Project ID",
    }),
    name: z.string().openapi({
      example: "Q4 Campaign",
      description: "Project name",
    }),
    latestFileUpdatedAt: dateTimeSchema.openapi({
      example: "2026-08-18T10:00:00.000Z",
      description: "Latest TaskFile updatedAt within this project",
    }),
  })
  .openapi("DriveTasksProjectItem");

export const driveTasksNoProjectItemSchema = z
  .object({
    type: z.literal("no-project").openapi({
      example: "no-project",
      description: "No-project row for unscoped tasks with files",
    }),
    id: z.literal("null").openapi({
      example: "null",
      description:
        'Sentinel id for no-project tasks (same as query literal "null")',
    }),
    latestFileUpdatedAt: dateTimeSchema.openapi({
      example: "2026-08-18T10:00:00.000Z",
      description: "Latest TaskFile updatedAt for tasks without a project",
    }),
  })
  .openapi("DriveTasksNoProjectItem");

export const driveTasksTaskItemSchema = z
  .object({
    type: z.literal("task").openapi({
      example: "task",
      description: "Task row with at least one file",
    }),
    id: z.string().openapi({
      example: "tsk_xyz789",
      description: "Task ID",
    }),
    name: z.string().openapi({
      example: "Design mockups",
      description: "Task name",
    }),
    latestFileUpdatedAt: dateTimeSchema.openapi({
      example: "2026-08-18T10:00:00.000Z",
      description: "Latest TaskFile updatedAt for this task",
    }),
  })
  .openapi("DriveTasksTaskItem");

export const driveTasksTaskFileItemSchema = z
  .object({
    type: z.literal("task-file").openapi({
      example: "task-file",
      description: "TaskFile row",
    }),
    id: z.string().openapi({
      example: "tf_123",
      description: "TaskFile ID",
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
    mimeType: z.string().nullable().openapi({
      example: "application/pdf",
      description: "MIME type (null if unknown)",
    }),
    updatedAt: dateTimeSchema.openapi({
      example: "2026-08-18T10:00:00.000Z",
      description: "TaskFile updatedAt",
    }),
  })
  .openapi("DriveTasksTaskFileItem");

export const driveTasksJobOutputItemSchema = z
  .object({
    type: z.literal("job-output").openapi({
      example: "job-output",
      description: "Job output blob row",
    }),
    id: z.string().openapi({
      example: "blb_123",
      description: "Blob ID",
    }),
    name: z.string().openapi({
      example: "agent-result.pdf",
      description: "Blob name",
    }),
    fileUrl: z.string().url().openapi({
      example: "https://coworker.example/output/file.pdf",
      description: "Blob file URL (fileUrl or sourceUrl)",
    }),
    size: z.number().int().nullable().openapi({
      example: 2048000,
      description: "File size in bytes (null if unknown)",
    }),
    mimeType: z.string().nullable().openapi({
      example: "application/pdf",
      description: "MIME type (null if unknown)",
    }),
    updatedAt: dateTimeSchema.openapi({
      example: "2026-08-18T10:00:00.000Z",
      description: "Blob updatedAt",
    }),
  })
  .openapi("DriveTasksJobOutputItem");

export const driveTasksListItemSchema = z
  .discriminatedUnion("type", [
    driveTasksProjectItemSchema,
    driveTasksNoProjectItemSchema,
    driveTasksTaskItemSchema,
    driveTasksTaskFileItemSchema,
    driveTasksJobOutputItemSchema,
  ])
  .openapi("DriveTasksListItem");

export type DriveTasksListItem = z.infer<typeof driveTasksListItemSchema>;

export const driveTasksListSchema = z
  .array(driveTasksListItemSchema)
  .openapi("DriveTasksList");

/**
 * Copy TaskFile to Drive request.
 */
const copyTaskFileRequestSchema = z.object({
  kind: z.literal("task-file").openapi({
    description: "Source kind: task-file for TaskFile",
  }),
  taskFileId: z.string().openapi({
    example: "tf_123",
    description: "TaskFile ID to copy",
  }),
  scope: driveFileScopeSchema.openapi({
    description:
      "Destination Drive scope: 'me' for personal, 'org' for organization",
  }),
  organizationId: z.string().optional().openapi({
    example: "org_123",
    description: "Organization ID (required when scope=org)",
  }),
});

const copyJobOutputRequestSchema = z.object({
  kind: z.literal("job-output").openapi({
    description: "Source kind: job-output for Blob",
  }),
  blobId: z.string().openapi({
    example: "blb_123",
    description: "Blob ID to copy",
  }),
  scope: driveFileScopeSchema.openapi({
    description:
      "Destination Drive scope: 'me' for personal, 'org' for organization",
  }),
  organizationId: z.string().optional().openapi({
    example: "org_123",
    description: "Organization ID (required when scope=org)",
  }),
});

export const copyTaskFileToDriveRequestSchema = z
  .discriminatedUnion("kind", [
    copyTaskFileRequestSchema,
    copyJobOutputRequestSchema,
  ])
  .openapi("CopyTaskFileToDriveRequest");

/**
 * Copy TaskFile to Drive response.
 */
export const copyTaskFileToDriveResponseSchema = z
  .object({
    name: z.string().openapi({
      example: "mockup-v2.pdf",
      description: "Copied file name",
    }),
    fileUrl: z.string().url().openapi({
      example: "https://store.public.blob.vercel-storage.com/drive/...",
      description: "Copied Drive file URL",
    }),
    pathname: z.string().openapi({
      example: "drive/users/user_123/mockup-v2.pdf",
      description: "Drive file pathname",
    }),
  })
  .openapi("CopyTaskFileToDriveResponse");
