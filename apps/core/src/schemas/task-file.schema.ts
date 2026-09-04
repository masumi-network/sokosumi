import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { coworkerSummarySchema } from "@/schemas/coworker.schema";
import { sokoBotSummarySchema } from "@/schemas/soko-bot.schema";
import { userSummarySchema } from "@/schemas/user.schema";

const taskFileUploaderUserSchema = z
  .object({
    type: z.literal("user"),
    id: z.string().openapi({ example: "user_123" }),
    user: userSummarySchema,
  })
  .openapi("TaskFileUploaderUser");

const taskFileUploaderCoworkerSchema = z
  .object({
    type: z.literal("coworker"),
    id: z.string().openapi({ example: "cow_123" }),
    coworker: coworkerSummarySchema,
  })
  .openapi("TaskFileUploaderCoworker");

const taskFileUploaderOrchestratorSchema = z
  .object({
    type: z.literal("orchestrator"),
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    sokoBot: sokoBotSummarySchema,
  })
  .openapi("TaskFileUploaderSokoBot");

export const taskFileUploaderSchema = z
  .discriminatedUnion("type", [
    taskFileUploaderUserSchema,
    taskFileUploaderCoworkerSchema,
    taskFileUploaderOrchestratorSchema,
  ])
  .openapi("TaskFileUploader");

export const taskFileStatusSchema = z
  .enum(["PENDING", "READY", "FAILED"])
  .openapi("TaskFileStatus");

export const taskFileOriginSchema = z
  .enum(["USER_UPLOAD", "TASK_OUTPUT"])
  .openapi("TaskFileOrigin");

export const taskFileSchema = z
  .object({
    id: z.string().openapi({ example: "tfile_123" }),
    taskId: z.string().openapi({ example: "tsk_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "report.pdf" }),
    fileUrl: z
      .string()
      .url()
      .nullable()
      .openapi({ example: "https://blob.vercel.app/tasks/tsk_123/report.pdf" }),
    mimeType: z.string().nullable().openapi({ example: "application/pdf" }),
    size: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .openapi({ example: 2048000 }),
    status: taskFileStatusSchema.openapi({
      description: "Sync status of the file",
    }),
    origin: taskFileOriginSchema.openapi({
      description: "Origin of the file",
    }),
    sourceUrl: z.string().url().nullable().openapi({
      example: "https://example.com/source.pdf",
      description: "Original source URL for output files",
    }),
    uploader: taskFileUploaderSchema.nullable().openapi({
      description:
        "Actor that uploaded the file. Null when both uploader FKs are unset (e.g. deleted actor).",
    }),
  })
  .openapi("TaskFile");

export const taskFilesSchema = z.array(taskFileSchema).openapi("TaskFiles");

export type TaskFileDto = z.infer<typeof taskFileSchema>;
