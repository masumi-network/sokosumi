import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";

import { dateTimeSchema } from "@/helpers/datetime.js";
import {
  sokosumiJobStatusSchema,
  taskStatusSchema,
} from "@/schemas/domain-enums.schema";

export const projectSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    workspaceId: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    name: z.string().openapi({ example: "Q1 research" }),
    description: z.string().nullable().openapi({ example: "Notes" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("Project");

export const projectListItemSchema = projectSchema
  .extend({
    taskCount: z.number().int().nonnegative().openapi({ example: 2 }),
    jobCount: z.number().int().nonnegative().openapi({ example: 1 }),
  })
  .openapi("ProjectListItem");

export const createProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).openapi({ example: "Q1 research" }),
    description: z
      .string()
      .trim()
      .max(10_000)
      .nullish()
      .openapi({ example: "Optional description" }),
  })
  .openapi("CreateProjectRequest");

export const patchProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(10_000).nullish().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.name === undefined && data.description === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Provide at least one of name or description",
        path: [],
      });
    }
  })
  .openapi("PatchProjectRequest");

export const addProjectJobRequestSchema = z
  .object({
    jobId: z.string().min(1).openapi({ example: "job_abc" }),
  })
  .openapi("AddProjectJobRequest");

export const addProjectTaskRequestSchema = z
  .object({
    taskId: z.string().min(1).openapi({ example: "tsk_abc" }),
  })
  .openapi("AddProjectTaskRequest");

const statusCountBaseSchema = z.object({
  count: z.number().int().nonnegative().openapi({ example: 2 }),
});

export const taskStatusCountSchema = statusCountBaseSchema
  .extend({
    status: taskStatusSchema.openapi({ example: TaskStatus.READY }),
  })
  .openapi("ProjectTaskStatusCount");

export const jobStatusCountSchema = statusCountBaseSchema
  .extend({
    status: sokosumiJobStatusSchema.openapi({
      example: SokosumiJobStatus.PROCESSING,
    }),
  })
  .openapi("ProjectJobStatusCount");

export const projectResourceStatsSchema = <
  TStatusCountSchema extends z.ZodType,
>(
  statusCountSchema: TStatusCountSchema,
) =>
  z.object({
    total: z.number().int().nonnegative().openapi({ example: 3 }),
    byStatus: z.array(statusCountSchema).openapi({ example: [] }),
  });

export const projectStatsEntrySchema = z
  .object({
    projectId: z.string().uuid().openapi({
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
    tasks: projectResourceStatsSchema(taskStatusCountSchema),
    jobs: projectResourceStatsSchema(jobStatusCountSchema),
  })
  .openapi("ProjectStatsEntry");

export const projectStatsBatchSchema = z
  .object({
    projects: z.array(projectStatsEntrySchema),
  })
  .openapi("ProjectStatsBatch");
