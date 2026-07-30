import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { taskStatusSchema } from "@/schemas/domain-enums.schema";

const taskLinkPeerTaskExample = {
  id: "tsk_b",
  name: "Review onboarding copy",
  status: TaskStatus.READY,
  archivedAt: null,
} as const;

const taskLinkResponseExample = {
  id: "tl_123",
  createdAt: "2026-03-25T10:00:00.000Z",
  updatedAt: "2026-03-25T10:05:00.000Z",
  relation: "blocked_by",
  peerTask: taskLinkPeerTaskExample,
  note: "Blocked until onboarding copy is approved",
} as const;

const createTaskLinkRequestExample = {
  toTaskId: "tsk_b",
  relation: "blocked_by",
  note: "Blocked until onboarding copy is approved",
} as const;

const patchTaskLinkRequestExample = {
  relation: "child",
  note: "Moved under the onboarding epic",
} as const;

export const taskLinkPeerTaskSchema = z
  .object({
    id: z.string().openapi({ example: "tsk_b" }),
    name: z.string().openapi({ example: "Review onboarding copy" }),
    status: taskStatusSchema.openapi({ example: TaskStatus.READY }),
    archivedAt: dateTimeSchema.nullable().openapi({ example: null }),
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
    "schedule_run",
    "schedule_series",
  ])
  .openapi("TaskLinkRelation");

export type TaskLinkRelationResponse = z.infer<typeof taskLinkRelationSchema>;

/** Relations users may create or patch. Schedule edges are system-managed. */
export const userWritableTaskLinkRelationSchema = z
  .enum(["related", "blocks", "blocked_by", "parent", "child", "duplicate"])
  .openapi("UserWritableTaskLinkRelation");

export type UserWritableTaskLinkRelationResponse = z.infer<
  typeof userWritableTaskLinkRelationSchema
>;

export const taskLinkSchema = z
  .object({
    id: z.string().openapi({ example: "tl_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    relation: taskLinkRelationSchema.openapi({ example: "blocked_by" }),
    peerTask: taskLinkPeerTaskSchema.openapi({
      example: taskLinkPeerTaskExample,
    }),
    note: z
      .string()
      .nullable()
      .openapi({ example: "Blocked until onboarding copy is approved" }),
  })
  .openapi({ example: taskLinkResponseExample })
  .openapi("TaskLink");

export type TaskLinkResponse = z.infer<typeof taskLinkSchema>;

export const taskLinksSchema = z.array(taskLinkSchema);

export const createTaskLinkRequestSchema = z
  .object({
    toTaskId: z.string().min(1).openapi({ example: "tsk_b" }),
    relation: userWritableTaskLinkRelationSchema.openapi({
      example: "blocked_by",
    }),
    note: z
      .string()
      .max(2000)
      .nullish()
      .openapi({ example: "Blocked until onboarding copy is approved" }),
  })
  .openapi({ example: createTaskLinkRequestExample });

export const patchTaskLinkRequestSchema = z
  .object({
    relation: userWritableTaskLinkRelationSchema.optional().openapi({
      example: "child",
    }),
    note: z
      .string()
      .max(2000)
      .nullish()
      .openapi({ example: "Moved under the onboarding epic" }),
  })
  .refine((data) => data.relation !== undefined || data.note !== undefined, {
    message: "At least one of relation or note is required",
    path: ["relation", "note"],
  })
  .openapi({ example: patchTaskLinkRequestExample });
