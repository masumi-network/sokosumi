import { z } from "@hono/zod-openapi";
import { Channel, TaskScheduleEventKind, TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime.js";
import { coworkerSummarySchema } from "@/schemas/coworker.schema";
import { channelSchema, taskStatusSchema } from "@/schemas/domain-enums.schema";
import {
  createJobRequestSchema,
  jobSummariesSchema,
} from "@/schemas/job.schema";
import { organizationSummarySchema } from "@/schemas/organization.schema";
import { taskShareSchema } from "@/schemas/share.schema";
import { sokoBotSummarySchema } from "@/schemas/soko-bot.schema";
import { taskFileSchema } from "@/schemas/task-file.schema";
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

const taskEventActorUserSchema = z
  .object({
    type: z.literal("user"),
    id: z.string().openapi({ example: "user_123" }),
    user: userSummarySchema,
  })
  .openapi("TaskEventActorUser");

const taskEventActorCoworkerSchema = z
  .object({
    type: z.literal("coworker"),
    id: z.string().openapi({ example: "cow_123" }),
    coworker: coworkerSummarySchema,
  })
  .openapi("TaskEventActorCoworker");

const taskEventActorSokoBotSchema = z
  .object({
    type: z.literal("sokoBot"),
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    sokoBot: sokoBotSummarySchema,
  })
  .openapi("TaskEventActorSokoBot");

export const taskEventActorSchema = z
  .discriminatedUnion("type", [
    taskEventActorUserSchema,
    taskEventActorCoworkerSchema,
    taskEventActorSokoBotSchema,
  ])
  .openapi("TaskEventActor");

export const taskEventSchema = z
  .object({
    id: z.string().openapi({ example: "evt_123" }),
    taskId: z.string().openapi({ example: "tsk_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    actor: taskEventActorSchema.nullable().openapi({
      description:
        "Actor that produced the event. Null when no actor FK is set.",
    }),
    /** @deprecated Use `actor` when `actor.type === "user"`. */
    userId: z.string().nullish().openapi({
      example: "user_123",
      deprecated: true,
      description: "Deprecated. Use actor when type is user.",
    }),
    /** @deprecated Use `actor` when `actor.type === "user"`. */
    user: userSummarySchema.nullish().openapi({
      deprecated: true,
      description:
        "Deprecated. Prefer actor. Emitted only when the preferred actor is user (prefer order: sokoBot → coworker → user). Legacy multi-FK rows may still set other actor FKs without this summary.",
    }),
    /** @deprecated Use `actor` when `actor.type === "coworker"`. */
    coworkerId: z.string().nullish().openapi({
      example: "cow_123",
      deprecated: true,
      description: "Deprecated. Use actor when type is coworker.",
    }),
    /** @deprecated Use `actor` when `actor.type === "coworker"`. */
    coworker: coworkerSummarySchema.nullish().openapi({
      deprecated: true,
      description:
        "Deprecated. Prefer actor. Emitted only when the preferred actor is coworker (prefer order: sokoBot → coworker → user). Legacy multi-FK rows may still set other actor FKs without this summary.",
    }),
    /** @deprecated Use `actor` when `actor.type === "sokoBot"`. */
    sokoBotId: z.string().uuid().nullish().openapi({
      example: "01960001-0001-7001-8001-000000000099",
      deprecated: true,
      description: "Deprecated. Use actor when type is sokoBot.",
    }),
    /** @deprecated Use `actor` when `actor.type === "sokoBot"`. */
    sokoBot: sokoBotSummarySchema.nullish().openapi({
      deprecated: true,
      description:
        "Deprecated. Prefer actor. Emitted only when the preferred actor is sokoBot (prefer order: sokoBot → coworker → user). Legacy multi-FK rows may still set other actor FKs without this summary.",
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
    scheduleKind: z.enum(TaskScheduleEventKind).nullish().openapi({
      description: "Schedule activity represented by this event",
      example: TaskScheduleEventKind.OCCURRENCE_SKIPPED,
    }),
    schedulePayload: z
      .record(z.string(), z.unknown())
      .nullish()
      .openapi({
        description: "Schedule activity details for audit and notifications",
        example: { occurrenceKey: "occurrence-key" },
      }),
    scheduleOperationId: z.string().uuid().nullish().openapi({
      description: "Idempotency identity for the schedule mutation",
      example: "123e4567-e89b-42d3-a456-426614174000",
    }),
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

const taskCreatorSokoBotSchema = z
  .object({
    type: z.literal("sokoBot"),
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    sokoBot: sokoBotSummarySchema,
  })
  .openapi("TaskCreatorSokoBot");

export const taskCreatorSchema = z
  .discriminatedUnion("type", [
    taskCreatorUserSchema,
    taskCreatorCoworkerSchema,
    taskCreatorSokoBotSchema,
  ])
  .openapi("TaskCreator");

const taskAssigneeCoworkerSchema = z
  .object({
    type: z.literal("coworker"),
    id: z.string().openapi({ example: "cow_123" }),
    coworker: coworkerSummarySchema,
  })
  .openapi("TaskAssigneeCoworker");

const taskAssigneeSokoBotSchema = z
  .object({
    type: z.literal("sokoBot"),
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    sokoBot: sokoBotSummarySchema,
  })
  .openapi("TaskAssigneeSokoBot");

export const taskAssigneeSchema = z
  .discriminatedUnion("type", [
    taskAssigneeCoworkerSchema,
    taskAssigneeSokoBotSchema,
  ])
  .openapi("TaskAssignee");

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
    description:
      "Marketplace coworker assignee. Null when the assignee is an orchestrator.",
  }),
  assigneeSokoBotId: z.string().uuid().nullable().openapi({
    example: "01960001-0001-7001-8001-000000000099",
    description:
      "Personal-assistant orchestrator assignee. Null when the assignee is a coworker.",
  }),
  assignee: z.union([taskAssigneeSchema, z.null()]).openapi({
    description:
      "Discriminated assignee: coworker, orchestrator, or unassigned.",
    example: null,
  }),
  /** @deprecated Marketplace-only. Use `assigneeId` or `assignee`. */
  coworkerId: z.string().nullable().openapi({
    example: "cow_123",
    deprecated: true,
    description:
      "Deprecated marketplace coworker assignee. Null when the assignee is an orchestrator.",
  }),
  /** @deprecated Marketplace-only. Use `assignee` when type is coworker. */
  coworker: z.union([coworkerSummarySchema, z.null()]).openapi({
    deprecated: true,
    description:
      "Deprecated marketplace coworker summary. Null when the assignee is an orchestrator.",
  }),
  creator: taskCreatorSchema.openapi({
    description:
      "Actor that created the task. Exactly one of user, coworker, or orchestrator.",
  }),
  /** @deprecated Use `creator` when `creator.type === "sokoBot"`. */
  sokoBotId: z.string().uuid().nullable().openapi({
    example: "01960001-0001-7001-8001-000000000099",
    deprecated: true,
    description:
      "Deprecated. Use creator when type is sokoBot. Only set when a Soko Bot created the task.",
  }),
  /** @deprecated Use `creator` when `creator.type === "sokoBot"`. */
  sokoBot: z.union([sokoBotSummarySchema, z.null()]).openapi({
    deprecated: true,
    description:
      "Deprecated. Use creator when type is sokoBot. Only set when a Soko Bot created the task.",
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
  scheduleRevision: z.number().int().nonnegative().default(0).openapi({
    description: "Revision used for optimistic schedule mutations",
    example: 0,
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
    files: z.array(taskFileSchema).openapi({
      example: [],
      description: "Files uploaded to this task (newest first).",
    }),
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

/**
 * Statuses that block on the human rather than on the coworker.
 *
 * Mirrors the web taskboard's `input-required` column so the /chat summary and
 * the board never disagree about what "waiting on you" means.
 */
export const TASK_AWAITING_INPUT_STATUSES = [
  "GRANT_PENDING",
  "INPUT_REQUIRED",
  "APPROVAL_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
] as const;

export const taskSummaryResponseSchema = z
  .object({
    since: dateTimeSchema.openapi({
      description:
        "Start of the reporting window, echoed back. Always set: either the caller's last session activity or the start of the rolling 24h fallback when that activity is missing or too recent.",
      example: "2026-08-10T09:00:00.000Z",
    }),
    completed: z.number().int().nonnegative().openapi({
      description:
        "Tasks that reached COMPLETED within the window. Approximated by updatedAt because Task has no completedAt column.",
      example: 4,
    }),
    awaitingInput: z.number().int().nonnegative().openapi({
      description:
        "Tasks currently blocked on the user. Point-in-time, so it ignores the window.",
      example: 2,
    }),
    createdByOtherHumans: z.number().int().nonnegative().openapi({
      description:
        "Tasks created within the window by a different human in the same workspace, narrowed by `scope` like the other counters. Always 0 in a personal workspace.",
      example: 3,
    }),
    lastVisitAt: dateTimeSchema.nullable().openapi({
      description:
        "Caller's most recent session activity (`max(Session.updatedAt)`), unmodified. Null only if the user has no sessions. Same signal as admin member last-seen.",
      example: "2026-08-10T09:00:00.000Z",
    }),
    basis: z.enum(["lastVisit", "recent"]).openapi({
      description:
        "Which window the counts cover: since the caller's last session activity (`lastVisit`), or a rolling 24h fallback (`recent`) when that activity is missing or too recent to be interesting.",
      example: "lastVisit",
    }),
    workedMinutes: z.number().int().nonnegative().openapi({
      description:
        "Minutes tasks spent in RUNNING inside the window, summed from status-transition events and clipped to the window bounds. Wall-clock time in progress, not billed compute.",
      example: 47,
    }),
  })
  .openapi("TaskActivitySummary");
