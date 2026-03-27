import { z } from "@hono/zod-openapi";
import { TaskEventOrigin, TaskLinkType, TaskStatus } from "@sokosumi/database";

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

export const taskLinkSchema = z
  .object({
    id: z.string().openapi({ example: "tl_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    type: z.enum(TaskLinkType).openapi({ example: TaskLinkType.RELATES }),
    fromTaskId: z.string().openapi({ example: "tsk_a" }),
    toTaskId: z.string().openapi({ example: "tsk_b" }),
    peerTaskId: z.string().openapi({ example: "tsk_b" }),
    direction: z
      .enum(["outgoing", "incoming"])
      .openapi({ example: "outgoing" }),
    note: z.string().nullable().openapi({ example: null }),
    peerTask: z
      .object({
        id: z.string().openapi({ example: "tsk_b" }),
        name: z.string().openapi({ example: "Follow up with reviewer" }),
        status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
        archivedAt: dateTimeSchema.nullable().openapi({ example: null }),
      })
      .nullable()
      .openapi({
        example: {
          id: "tsk_b",
          name: "Follow up with reviewer",
          status: TaskStatus.READY,
          archivedAt: null,
        },
      }),
  })
  .openapi("TaskLink");

export type TaskLinkResponse = z.infer<typeof taskLinkSchema>;

export const taskLinksSchema = z.array(taskLinkSchema);

export const createTaskLinkRequestSchema = z.object({
  toTaskId: z.string().min(1).openapi({ example: "tsk_b" }),
  type: z.enum(TaskLinkType).openapi({ example: TaskLinkType.RELATES }),
  note: z.string().max(2000).nullish().openapi({ example: null }),
});

export const patchTaskLinkRequestSchema = z
  .object({
    type: z.enum(TaskLinkType).optional().openapi({
      example: TaskLinkType.RELATES,
    }),
    note: z.string().max(2000).nullish().openapi({ example: null }),
  })
  .refine((data) => data.type !== undefined || data.note !== undefined, {
    message: "At least one of type or note is required",
    path: ["type", "note"],
  });

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
    links: taskLinksSchema.openapi({ example: [] }),
  })
  .openapi("Task");

export const tasksSchema = z.array(taskSchema);

export const createTaskJobRequestSchema = createJobRequestSchema.extend({
  agentId: z.string().openapi({ example: "agent_123" }),
});
