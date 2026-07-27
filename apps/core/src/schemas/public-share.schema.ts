import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";

import { dateTimeSchema } from "@/helpers/datetime.js";
import {
  sokosumiJobStatusSchema,
  taskStatusSchema,
} from "@/schemas/domain-enums.schema";
import { jobSchema } from "@/schemas/job.schema.js";
import { jobShareSchema, taskShareSchema } from "@/schemas/share.schema.js";
import {
  taskEventChannelField,
  taskEventDeprecatedOriginField,
} from "@/schemas/task.schema";

export const putJobShareRequestSchema = z.object({
  allowSearchIndexing: z.boolean().openapi({ example: true }),
});

export const putTaskShareRequestSchema = putJobShareRequestSchema;

export const publicSharedTaskAssigneeSchema = z
  .object({
    id: z.string().openapi({ example: "cow_123" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    slug: z.string().openapi({ example: "ops-agent" }),
    image: z.string().nullish().openapi({
      example: "https://example.com/coworker.png",
    }),
  })
  .openapi("PublicSharedTaskAssignee");

export const publicSharedTaskJobSchema = z
  .object({
    id: z.string().openapi({ example: "job_123" }),
    createdAt: dateTimeSchema,
    completedAt: dateTimeSchema.nullish(),
    name: z.string().nullish().openapi({ example: "Draft answer" }),
    status: sokosumiJobStatusSchema.openapi({
      example: SokosumiJobStatus.PROCESSING,
    }),
    agentName: z.string().openapi({ example: "Research Agent" }),
    shareToken: z.string().nullish().openapi({ example: "public-share-token" }),
  })
  .openapi("PublicSharedTaskJob");

export const publicSharedTaskMilestoneSchema = z
  .object({
    id: z.string().openapi({ example: "evt_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    channel: taskEventChannelField,
    origin: taskEventDeprecatedOriginField,
    status: z
      .union([taskStatusSchema, z.null()])
      .openapi({ example: TaskStatus.RUNNING }),
    comment: z
      .string()
      .nullable()
      .openapi({ example: "Please review the draft" }),
    credits: z.number().nullable().openapi({ example: 1.5 }),
    transactionId: z.string().nullable().openapi({ example: "txn_123" }),
    actorName: z.string().nullable().openapi({ example: "Ada Lovelace" }),
    actorImage: z.string().nullable().openapi({
      example: "https://example.com/avatar.png",
    }),
  })
  .openapi("PublicSharedTaskMilestone");

export const publicSharedTaskSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "Review onboarding" }),
    description: z.string().nullish().openapi({ example: "Notes go here" }),
    status: taskStatusSchema.openapi({ example: TaskStatus.READY }),
    assignee: publicSharedTaskAssigneeSchema.nullish(),
    /** @deprecated Use `assignee`. */
    coworker: publicSharedTaskAssigneeSchema.nullish().openapi({
      deprecated: true,
      description: "Deprecated. Use assignee instead.",
    }),
    jobs: z.array(publicSharedTaskJobSchema).openapi({ example: [] }),
    events: z.array(publicSharedTaskMilestoneSchema).openapi({ example: [] }),
  })
  .openapi("PublicSharedTask");

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
