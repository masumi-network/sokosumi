import { z } from "@hono/zod-openapi";
import { TaskEventOrigin } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { coworkerSummarySchema } from "@/schemas/coworker.schema";
import {
  createJobRequestSchema,
  jobSummariesSchema,
} from "@/schemas/job.schema";
import { organizationSummarySchema } from "@/schemas/organization.schema";
import { taskShareSchema } from "@/schemas/share.schema";
import { taskLinksSchema } from "@/schemas/task-link.schema";
import { userSummarySchema } from "@/schemas/user.schema";
import { workspaceSummarySchema } from "@/schemas/workspace.schema";

export const taskEventSchema = z
  .object({
    id: z.string().openapi({ example: "evt_123" }),
    taskId: z.string().openapi({ example: "tsk_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    userId: z.string().nullish().openapi({ example: "user_123" }),
    user: userSummarySchema.nullish().openapi({
      description:
        "Mirrors userId: omitted, null, or set when the actor user was loaded.",
    }),
    coworkerId: z.string().nullish().openapi({ example: "cow_123" }),
    coworker: coworkerSummarySchema.nullish().openapi({
      description:
        "Mirrors coworkerId: omitted, null, or set when the coworker relation was loaded.",
    }),
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

const taskBaseSchema = z.object({
  id: z.string().openapi({ example: "tsk_123" }),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  userId: z.string().openapi({ example: "user_123" }),
  user: userSummarySchema,
  organizationId: z.string().nullable().openapi({ example: "org_123" }),
  organization: organizationSummarySchema.nullable(),
  projectId: z.string().uuid().nullable().openapi({
    example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  }),
  coworkerId: z.string().nullable().openapi({ example: "cow_123" }),
  coworker: coworkerSummarySchema.nullable(),
  name: z.string().openapi({ example: "Review onboarding" }),
  description: z.string().nullable().openapi({ example: "Notes go here" }),
  status: z.enum(TaskStatus).openapi({ example: TaskStatus.READY }),
  pendingApproval: z.boolean().openapi({
    description:
      "True when the task is parked awaiting vendor workspace grant approval",
    example: false,
  }),
  pendingVendorGrantId: z.string().uuid().nullable().openapi({
    description: "Vendor grant id when pendingApproval is true; null otherwise",
    example: null,
  }),
  metadata: z.string().nullable().openapi({
    description: "Serialized task schedule metadata JSON",
    example: null,
  }),
  nextRunAt: dateTimeSchema.nullable().openapi({
    description: "Next scheduled run time for queued tasks",
    example: "2026-06-24T09:00:00.000Z",
  }),
  credits: z.number().openapi({ example: 5 }),
  events: z.array(taskEventSchema).openapi({ example: [] }),
  jobs: jobSummariesSchema.openapi({ example: [] }),
  workspace: workspaceSummarySchema,
});

export const taskListItemSchema = taskBaseSchema
  .omit({ credits: true, events: true, jobs: true })
  .extend({
    jobsCount: z.number().int().nonnegative().openapi({ example: 2 }),
    commentsCount: z.number().int().nonnegative().openapi({ example: 4 }),
  })
  .openapi("TaskListItem");

export const taskSchema = taskBaseSchema
  .extend({
    // Union-with-null instead of `taskShareSchema.nullable()`: `.nullable()` on a
    // named `.openapi(...)` schema both leaks `| null` into the generated
    // `TaskShare` type and makes the generated response transformer call the
    // share date-converter unconditionally (crashing on a null share). The union
    // form keeps `TaskShare` non-null and emits an `if (data.share)` guard.
    // Mirrors `jobSchema.share`.
    share: z.union([taskShareSchema, z.null()]).openapi({ example: null }),
    links: taskLinksSchema.openapi({ example: [] }),
  })
  .openapi("Task");

export const taskListSchema = z.array(taskListItemSchema);

export const tasksSchema = z.array(taskSchema);

export const createTaskJobRequestSchema = createJobRequestSchema.extend({
  agentId: z.string().openapi({ example: "agent_123" }),
});

export const taskWorkspaceSchema = z
  .object({
    name: z.string().openapi({
      description: "Task title",
      example: "Research competitor pricing",
    }),
    workspaceId: z.string().uuid().openapi({
      description: "Workspace id for the task",
      example: "11111111-1111-7111-8111-111111111111",
    }),
    organizationId: z.string().nullable().openapi({
      description:
        "Organization id for the workspace, or null for a personal workspace",
      example: "org_123",
    }),
  })
  .openapi("TaskWorkspace");
