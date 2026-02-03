import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const orchestratorSchema = z
  .object({
    id: z.string().openapi({ example: "orc_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    slug: z.string().openapi({ example: "ops-agent" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    url: z.string().nullish().openapi({ example: "https://example.com" }),
    email: z.string().nullish().openapi({ example: "ops@example.com" }),
    description: z.string().nullish().openapi({ example: "Ops helper" }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/logo" }),
  })
  .openapi("Orchestrator");

export const taskEventSchema = z
  .object({
    id: z.string().openapi({ example: "evt_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    comment: z.string().nullish().openapi({ example: "Looks good." }),
    status: z
      .enum(TaskStatus)
      .nullish()
      .openapi({ example: TaskStatus.RUNNING }),
    userId: z.string().nullish().openapi({ example: "user_123" }),
    orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
  })
  .openapi("TaskEvent");

export const taskCommentSchema = z
  .object({
    id: z.string().openapi({ example: "com_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    text: z.string().openapi({ example: "Looks good." }),
    userId: z.string().nullish().openapi({ example: "user_123" }),
    orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
  })
  .openapi("TaskComment");

export const taskSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().openapi({ example: "user_123" }),
    orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
    name: z.string().openapi({ example: "Review onboarding" }),
    description: z.string().nullish().openapi({ example: "Notes go here" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
    events: z.array(taskEventSchema).openapi({ example: [] }),
    jobIds: z.array(z.string()).openapi({ example: [] }),
  })
  .openapi("Task");

export const tasksSchema = z.array(taskSchema).openapi("Tasks");

export const addTaskJobRequestSchema = z.object({
  jobId: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
});
