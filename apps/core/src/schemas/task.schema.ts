import { z } from "@hono/zod-openapi";
import { Channel, TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { coworkerSummarySchema } from "@/schemas/coworker.schema";
import { channelSchema, taskStatusSchema } from "@/schemas/domain-enums.schema";
import {
  createJobRequestSchema,
  jobSummariesSchema,
} from "@/schemas/job.schema";
import { orchestratorSummarySchema } from "@/schemas/orchestrator.schema";
import { organizationSummarySchema } from "@/schemas/organization.schema";
import { taskShareSchema } from "@/schemas/share.schema";
import { taskLinksSchema } from "@/schemas/task-link.schema";
import { userSummarySchema } from "@/schemas/user.schema";
import { workspaceSummarySchema } from "@/schemas/workspace.schema";

const deprecatedOriginField = channelSchema.openapi({
  deprecated: true,
  example: Channel.SLACK,
  description: "Deprecated. Use channel instead.",
});

export const taskEventChannelField = channelSchema.openapi({
  example: Channel.SLACK,
  description:
    "Channel of the task event. Defaults to SOKOSUMI when neither channel nor deprecated origin is set.",
});

export const taskEventDeprecatedOriginField = deprecatedOriginField;

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
    orchestratorId: z.string().uuid().nullish().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    orchestrator: orchestratorSummarySchema.nullish().openapi({
      description:
        "Mirrors orchestratorId: omitted, null, or set when the orchestrator relation was loaded.",
    }),
    transactionId: z.string().nullish().openapi({ example: "txn_123" }),
    credits: z.number().nullish().openapi({ example: 2.5 }),
    comment: z.string().nullish().openapi({ example: "Looks good." }),
    authenticationUrl: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/oauth/authorize" }),
    channel: taskEventChannelField,
    origin: taskEventDeprecatedOriginField,
    status: z
      .union([taskStatusSchema, z.null()])
      .optional()
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

const taskCreatorUserSchema = z
  .object({
    type: z.literal("user"),
    id: z.string().openapi({ example: "user_123" }),
    user: userSummarySchema,
  })
  .openapi("TaskCreatorUser");

const taskCreatorCoworkerSchema = z
  .object({
    type: z.literal("coworker"),
    id: z.string().openapi({ example: "cow_123" }),
    coworker: coworkerSummarySchema,
  })
  .openapi("TaskCreatorCoworker");

const taskCreatorOrchestratorSchema = z
  .object({
    type: z.literal("orchestrator"),
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    orchestrator: orchestratorSummarySchema,
  })
  .openapi("TaskCreatorOrchestrator");

export const taskCreatorSchema = z
  .discriminatedUnion("type", [
    taskCreatorUserSchema,
    taskCreatorCoworkerSchema,
    taskCreatorOrchestratorSchema,
  ])
  .openapi("TaskCreator");

const taskBaseSchema = z.object({
  id: z.string().openapi({ example: "tsk_123" }),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  ownerId: z.string().openapi({
    example: "user_123",
    description: "Task owner. Always a user.",
  }),
  owner: userSummarySchema,
  /** @deprecated Use `ownerId`. */
  userId: z.string().openapi({
    example: "user_123",
    deprecated: true,
    description: "Deprecated. Use ownerId instead.",
  }),
  /** @deprecated Use `owner`. */
  user: userSummarySchema.openapi({
    deprecated: true,
    description: "Deprecated. Use owner instead.",
  }),
  organizationId: z.string().nullable().openapi({ example: "org_123" }),
  organization: organizationSummarySchema.nullable(),
  projectId: z.string().uuid().nullable().openapi({
    example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  }),
  assigneeId: z.string().nullable().openapi({
    example: "cow_123",
    description: "Marketplace coworker assignee. Never an orchestrator.",
  }),
  assignee: coworkerSummarySchema.nullable(),
  /** @deprecated Use `assigneeId`. */
  coworkerId: z.string().nullable().openapi({
    example: "cow_123",
    deprecated: true,
    description: "Deprecated. Use assigneeId instead.",
  }),
  /** @deprecated Use `assignee`. */
  coworker: coworkerSummarySchema.nullable().openapi({
    deprecated: true,
    description: "Deprecated. Use assignee instead.",
  }),
  creator: taskCreatorSchema.openapi({
    description:
      "Actor that created the task. Exactly one of user, coworker, or orchestrator.",
  }),
  /** @deprecated Use `creator` when `creator.type === "orchestrator"`. */
  orchestratorId: z.string().uuid().nullable().openapi({
    example: "01960001-0001-7001-8001-000000000099",
    deprecated: true,
    description:
      "Deprecated. Use creator when type is orchestrator. Only set when an orchestrator created the task.",
  }),
  /** @deprecated Use `creator` when `creator.type === "orchestrator"`. */
  orchestrator: orchestratorSummarySchema.nullable().openapi({
    deprecated: true,
    description:
      "Deprecated. Use creator when type is orchestrator. Only set when an orchestrator created the task.",
  }),
  name: z.string().openapi({ example: "Review onboarding" }),
  description: z.string().nullable().openapi({ example: "Notes go here" }),
  status: taskStatusSchema.openapi({
    example: TaskStatus.READY,
    description:
      "GRANT_PENDING: blocked until vendor workspace access is granted.",
  }),
  grantResumeStatus: z.enum(["DRAFT", "READY"]).nullable().openapi({
    description:
      "Target status after vendor workspace grant approval. Exposed on the task API only while status is GRANT_PENDING; null otherwise.",
    example: null,
  }),
  pendingVendorGrantId: z.string().uuid().nullable().openapi({
    description:
      "Vendor grant blocking this task. Exposed on the task API only while status is GRANT_PENDING so integrators can correlate the parked task with the grant; null otherwise.",
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
