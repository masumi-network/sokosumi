import { z } from "@hono/zod-openapi";
import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { jobSchema } from "@/schemas/job.schema.js";

const publicShareBaseSchema = z.object({
  id: z.string().openapi({ example: "share_123" }),
  token: z.string().openapi({ example: "public-share-token" }),
  allowSearchIndexing: z.boolean().openapi({ example: true }),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export const jobShareSchema = publicShareBaseSchema
  .extend({
    jobId: z.string().openapi({ example: "job_123" }),
  })
  .openapi("JobShare");

export const taskShareSchema = publicShareBaseSchema
  .extend({
    taskId: z.string().openapi({ example: "tsk_123" }),
  })
  .openapi("TaskShare");

export const putJobShareRequestSchema = z.object({
  allowSearchIndexing: z.boolean().openapi({ example: true }),
});

export const putTaskShareRequestSchema = putJobShareRequestSchema;

export const publicSharedJobResponseSchema = z
  .object({
    job: jobSchema,
    share: jobShareSchema,
  })
  .openapi("PublicSharedJobResponse");

export const publicSharedTaskCoworkerSchema = z
  .object({
    id: z.string().openapi({ example: "cow_123" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    slug: z.string().openapi({ example: "ops-agent" }),
    image: z.string().nullish().openapi({
      example: "https://example.com/coworker.png",
    }),
  })
  .openapi("PublicSharedTaskCoworker");

export const publicSharedTaskJobSchema = z
  .object({
    id: z.string().openapi({ example: "job_123" }),
    createdAt: dateTimeSchema,
    completedAt: dateTimeSchema.nullish(),
    name: z.string().nullish().openapi({ example: "Draft answer" }),
    status: z
      .enum(SokosumiJobStatus)
      .openapi({ example: SokosumiJobStatus.PROCESSING }),
    agentName: z.string().openapi({ example: "Research Agent" }),
    shareToken: z.string().nullish().openapi({ example: "public-share-token" }),
  })
  .openapi("PublicSharedTaskJob");

export const publicSharedTaskMilestoneSchema = z
  .object({
    id: z.string().openapi({ example: "evt_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    origin: z
      .enum(TaskEventOrigin)
      .openapi({ example: TaskEventOrigin.SOKOSUMI }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.RUNNING }),
    credits: z.number().nullish().openapi({ example: 1.5 }),
  })
  .openapi("PublicSharedTaskMilestone");

export const publicSharedTaskSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "Review onboarding" }),
    description: z.string().nullish().openapi({ example: "Notes go here" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
    coworker: publicSharedTaskCoworkerSchema.nullish(),
    jobs: z.array(publicSharedTaskJobSchema).openapi({ example: [] }),
    events: z.array(publicSharedTaskMilestoneSchema).openapi({ example: [] }),
  })
  .openapi("PublicSharedTask");

export const publicSharedTaskResponseSchema = z
  .object({
    task: publicSharedTaskSchema,
    share: taskShareSchema,
  })
  .openapi("PublicSharedTaskResponse");

export const publicSharedJobResourceSchema = z
  .object({
    kind: z.literal("job"),
    job: jobSchema,
    share: jobShareSchema,
  })
  .openapi("PublicSharedJobResource");

export const publicSharedTaskResourceSchema = z
  .object({
    kind: z.literal("task"),
    task: publicSharedTaskSchema,
    share: taskShareSchema,
  })
  .openapi("PublicSharedTaskResource");

export const publicSharedResourceResponseSchema = z
  .discriminatedUnion("kind", [
    publicSharedJobResourceSchema,
    publicSharedTaskResourceSchema,
  ])
  .openapi("PublicSharedResourceResponse");
