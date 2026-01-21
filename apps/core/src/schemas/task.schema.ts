import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";

import { attachmentSchema } from "./attachment.schema";


export const taskActorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
  }),
  z.object({
    type: z.literal("orchestrator"),
    orchestratorId: z.string().openapi({ example: "orc_123" }),
  }),
]);

export const orchestratorSchema = z
  .object({
    id: z.string().openapi({ example: "orc_123" }),
    slug: z.string().openapi({ example: "ops-agent" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    url: z.string().nullish().openapi({ example: "https://example.com" }),
    email: z.string().nullish().openapi({ example: "ops@example.com" }),
    description: z.string().nullish().openapi({ example: "Ops helper" }),
    image: z.string().nullish().openapi({ example: "https://example.com/logo" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("Orchestrator");

export const taskEventSchema = z
  .object({
    id: z.string().openapi({ example: "evt_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.RUNNING }),
    userId: z.string().nullish().openapi({ example: "user_123" }),
    orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
  })
  .openapi("TaskEvent");

export const taskCommentSchema = z
  .object({
    id: z.string().openapi({ example: "com_123" }),
    content: z.string().openapi({ example: "Looks good." }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().nullish().openapi({ example: "user_123" }),
    orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
    attachments: z.array(attachmentSchema).openapi({ example: [] }),
  })
  .openapi("TaskComment");

export const taskSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_123" }),
    userId: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Review onboarding" }),
    description: z.string().nullish().openapi({ example: "Notes go here" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
    orchestrator: orchestratorSchema.nullish(),
    attachments: z.array(attachmentSchema).openapi({ example: [] }),
    _count: z
      .object({
        comments: z.number().openapi({ example: 2 }),
      })
      .openapi({ example: { comments: 2 } }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("Task");

export const tasksSchema = z.array(taskSchema).openapi("Tasks");

export const createTaskRequestSchema = z.object({
  name: z.string().min(1).max(120).openapi({ example: "Review onboarding" }),
  description: z.string().nullish().openapi({ example: "Notes go here" }),
  orchestratorId: z.string().nullish().openapi({ example: "orc_123" }),
});

export const updateTaskRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional().openapi({
      example: "Updated task title",
    }),
    description: z.string().nullish().optional().openapi({
      example: "Updated description",
    }),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined,
    {
      message: "At least one field must be provided",
      path: ["name", "description"],
    },
  );

export const createTaskCommentRequestSchema = z.object({
  content: z.string().min(1).openapi({ example: "Looks good." }),
  actor: taskActorSchema.optional(),
});

export const updateTaskCommentRequestSchema = z
  .object({
    content: z.string().min(1).openapi({ example: "Updated comment" }),
  });
  

export const createTaskEventRequestSchema = z.object({
  status: z.enum(TaskStatus).openapi({ example: TaskStatus.RUNNING }),
  actor: taskActorSchema.optional(),
});
