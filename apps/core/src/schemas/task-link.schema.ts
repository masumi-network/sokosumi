import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const taskLinkPeerTaskSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_b" }),
    name: z.string().openapi({ example: "Review onboarding" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
  })
  .openapi("TaskLinkPeerTask");

export type TaskLinkPeerTaskResponse = z.infer<typeof taskLinkPeerTaskSchema>;

export const taskLinkRelationSchema = z
  .enum([
    "related",
    "blocks",
    "blocked_by",
    "parent",
    "child",
    "duplicate",
  ])
  .openapi("TaskLinkRelation");

export type TaskLinkRelationResponse = z.infer<typeof taskLinkRelationSchema>;

export const taskLinkSchema = z
  .object({
    id: z.string().openapi({ example: "tl_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    relation: taskLinkRelationSchema.openapi({ example: "related" }),
    peerTask: taskLinkPeerTaskSchema.openapi({
      example: {
        id: "tsk_b",
        name: "Review onboarding",
        status: "READY",
      },
    }),
    note: z.string().nullable().openapi({ example: null }),
  })
  .openapi("TaskLink");

export type TaskLinkResponse = z.infer<typeof taskLinkSchema>;

export const taskLinksSchema = z.array(taskLinkSchema);

export const createTaskLinkRequestSchema = z.object({
  toTaskId: z.string().min(1).openapi({ example: "tsk_b" }),
  relation: taskLinkRelationSchema.openapi({ example: "related" }),
  note: z.string().max(2000).nullish().openapi({ example: null }),
});

export const patchTaskLinkRequestSchema = z
  .object({
    relation: taskLinkRelationSchema.optional().openapi({
      example: "related",
    }),
    note: z.string().max(2000).nullish().openapi({ example: null }),
  })
  .refine((data) => data.relation !== undefined || data.note !== undefined, {
    message: "At least one of relation or note is required",
    path: ["relation", "note"],
  });
