import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { taskStatusSchema } from "@/schemas/domain-enums.schema";

const taskLinkPeerTaskExample = {
  id: "tsk_b",
  name: "Review onboarding copy",
  status: TaskStatus.READY,
  archivedAt: null,
  identifier: "SOK-12",
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
    identifier: z.string().nullable().openapi({
      example: "SOK-12",
      description:
        "Project identifier and number, e.g. SOK-123. Null when the peer has no project.",
    }),
  })
  .openapi("TaskLinkPeerTask");

const taskLinkRelationSchema = z
  .enum(["related", "blocks", "blocked_by", "parent", "child", "duplicate"])
  .openapi("TaskLinkRelation");

export type TaskLinkRelationResponse = z.infer<typeof taskLinkRelationSchema>;

/** Relations users may create or patch. */
const userWritableTaskLinkRelationSchema = z
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

const taskPlanItemSchema = z
  .object({
    depth: z.number().int().min(1).openapi({
      example: 1,
      description: "Links between the opened Task and this one (1 is direct).",
    }),
    relation: z.enum(["blocked_by", "parent"]).openapi({
      example: "blocked_by",
      description:
        "Relation from the Task one level up: blocked_by (this Task blocks it) or parent (this Task is its sub-task).",
    }),
    task: taskLinkPeerTaskSchema,
    repeat: z.enum(["loops_back", "shown_above"]).nullable().openapi({
      example: null,
      description:
        "loops_back: an ancestor on this path. shown_above: already an earlier row. Repeats are not expanded.",
    }),
    hasMore: z.boolean().openapi({
      example: false,
      description: "At the depth limit and has visible links beyond it.",
    }),
  })
  .openapi("TaskPlanItem");

export const taskPlanSchema = z
  .object({
    items: z.array(taskPlanItemSchema).openapi({
      description: "Depth-first rows, blockers before sub-tasks.",
    }),
    truncated: z.boolean().openapi({
      example: false,
      description: "Row or link limit reached; the plan shows only part.",
    }),
  })
  .openapi("TaskPlan");
