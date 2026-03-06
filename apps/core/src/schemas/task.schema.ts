import { z } from "@hono/zod-openapi";
import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { createJobRequestSchema, jobsSchema } from "@/schemas/job.schema";

export const taskEventSchema = z
  .object({
    id: z.string().openapi({ example: "evt_123" }),
    taskId: z.string().openapi({ example: "tsk_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().nullish().openapi({ example: "user_123" }),
    coworkerId: z.string().nullish().openapi({ example: "cow_123" }),
    transactionId: z.string().nullish().openapi({ example: "txn_123" }),
    credits: z.number().nullish().openapi({ example: 2.5 }),
    comment: z.string().nullish().openapi({ example: "Looks good." }),
    authenticationUrl: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/oauth/authorize" }),
    origin: z.enum(TaskEventOrigin).openapi({ example: TaskEventOrigin.SLACK }),
    status: z
      .enum(TaskStatus)
      .nullish()
      .openapi({ example: TaskStatus.RUNNING }),
  })
  .openapi("TaskEvent");

export const taskCommentSchema = z
  .object({
    id: z.string().openapi({ example: "com_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    text: z.string().openapi({ example: "Looks good." }),
    userId: z.string().nullish().openapi({ example: "user_123" }),
    coworkerId: z.string().nullish().openapi({ example: "cow_123" }),
  })
  .openapi("TaskComment");

export const taskSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().openapi({ example: "user_123" }),
    organizationId: z.string().nullable().openapi({ example: "org_123" }),
    coworkerId: z.string().nullable().openapi({ example: "cow_123" }),
    name: z.string().openapi({ example: "Review onboarding" }),
    description: z.string().nullable().openapi({ example: "Notes go here" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
    credits: z.number().openapi({ example: 5 }),
    events: z.array(taskEventSchema).openapi({ example: [] }),
    jobs: jobsSchema.openapi({ example: [] }),
  })
  .openapi("Task");

export const tasksSchema = z.array(taskSchema).openapi("Tasks");

export const createTaskJobRequestSchema = createJobRequestSchema.extend({
  agentId: z.string().openapi({ example: "agent_123" }),
});
