import { z } from "@hono/zod-openapi";
import { TaskScheduleEndsMode, TaskScheduleRunState } from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { dateTimeSchema } from "@/helpers/datetime";
import { refineAssigneeXorConflict } from "@/helpers/task-assignee-alias";
import { coworkerSchema } from "@/schemas/coworker.schema";
import {
  taskScheduleEndsModeSchema,
  taskScheduleStateSchema,
  taskVisibilitySchema,
} from "@/schemas/domain-enums.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

/**
 * Task Schedule resource (`/tasks/schedules`, ADR 0041): a repeating rule
 * plus the blueprint of the Task each Run creates.
 */
const taskScheduleRuleFieldsSchema = z.object({
  expr: z.string().min(1).openapi({
    description: "Cron expression for Runs, read in `timezone`",
    example: "0 9 * * 1",
  }),
  timezone: z.string().min(1).openapi({
    description: "IANA timezone for the rule",
    example: "Europe/Berlin",
  }),
  intervalDays: z.number().int().positive().nullish().openapi({
    description:
      "When greater than 1, a Run every N calendar days from anchorAt at its local time, instead of the cron day fields",
    example: 2,
  }),
  anchorAt: dateTimeSchema.nullish().openapi({
    description:
      "First Run for intervalDays rules (required when intervalDays > 1)",
    example: "2026-10-01T07:00:00.000Z",
  }),
  endsMode: taskScheduleEndsModeSchema,
  endsOn: dateTimeSchema.nullish().openapi({
    description: "Last possible Run when endsMode is ON",
    example: "2026-12-31T23:59:59.000Z",
  }),
  targetRunCount: z.number().int().positive().nullish().openapi({
    description: "Total Runs when endsMode is AFTER",
    example: 10,
  }),
});

function refineTaskScheduleRule(
  data: z.infer<typeof taskScheduleRuleFieldsSchema>,
  ctx: z.RefinementCtx,
): void {
  if (data.endsMode === TaskScheduleEndsMode.ON && !data.endsOn) {
    ctx.addIssue({
      code: "custom",
      message: "endsOn is required when endsMode is ON",
      path: ["endsOn"],
    });
  }
  if (data.endsMode !== TaskScheduleEndsMode.ON && data.endsOn) {
    ctx.addIssue({
      code: "custom",
      message: "endsOn is allowed only when endsMode is ON",
      path: ["endsOn"],
    });
  }
  if (
    data.endsMode === TaskScheduleEndsMode.AFTER &&
    data.targetRunCount == null
  ) {
    ctx.addIssue({
      code: "custom",
      message: "targetRunCount is required when endsMode is AFTER",
      path: ["targetRunCount"],
    });
  }
  if (
    data.endsMode !== TaskScheduleEndsMode.AFTER &&
    data.targetRunCount != null
  ) {
    ctx.addIssue({
      code: "custom",
      message: "targetRunCount is allowed only when endsMode is AFTER",
      path: ["targetRunCount"],
    });
  }
  if (data.intervalDays != null && data.intervalDays > 1 && !data.anchorAt) {
    ctx.addIssue({
      code: "custom",
      message: "anchorAt is required when intervalDays is greater than 1",
      path: ["anchorAt"],
    });
  }
}

/** Create: timezone and endsMode default to UTC and NEVER. */
export const taskScheduleRuleSchema = taskScheduleRuleFieldsSchema
  .extend({
    timezone: taskScheduleRuleFieldsSchema.shape.timezone.default("UTC"),
    endsMode: taskScheduleRuleFieldsSchema.shape.endsMode.default(
      TaskScheduleEndsMode.NEVER,
    ),
  })
  .superRefine(refineTaskScheduleRule)
  .openapi("TaskScheduleRule");

/**
 * PATCH replaces the whole rule, so nothing defaults: an omitted timezone or
 * end mode would otherwise silently reset to UTC or NEVER.
 */
export const taskScheduleRuleReplacementSchema = taskScheduleRuleFieldsSchema
  .superRefine(refineTaskScheduleRule)
  .openapi("TaskScheduleRuleReplacement");

const taskScheduleNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.NAME_MAX_LENGTH)
  .openapi({ example: "Weekly report" });

const taskScheduleAssigneeFields = {
  assigneeId: z.string().min(1).nullish().openapi({
    description: "Coworker assignee of each created Task",
    example: "cow_123",
  }),
  assigneeSokoBotId: z.string().uuid().nullish().openapi({
    description: "Soko Bot assignee of each created Task",
    example: "01960001-0001-7001-8001-000000000099",
  }),
  assigneeUserId: z.string().min(1).nullish().openapi({
    description:
      "Legacy compatibility field. Workspace members cannot be assigned to Task Schedules; send null to clear an existing member assignee.",
    example: "user_123",
  }),
};

export const taskScheduleAssigneesSchema = z
  .object({
    coworkers: z.array(coworkerSchema),
    sokoBot: z
      .object({
        id: z.string().uuid(),
        name: z.string().nullable(),
        avatarSeed: z.string().nullable(),
        avatarImageUrl: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi("TaskScheduleAssignees");

export const createTaskScheduleRequestSchema = z
  .object({
    operationId: z.uuid().optional().openapi({
      description:
        "Idempotency key, scoped to the active workspace. A retry with the same key and body returns the schedule the first request made; the same key with a different body or creator is a 409 schedule_operation_conflict.",
      example: "01960001-0001-7001-8001-0000000000cc",
    }),
    name: taskScheduleNameSchema,
    description: z.string().nullish(),
    projectId: z.string().uuid().nullish(),
    visibility: taskVisibilitySchema.optional().openapi({
      description:
        "PUBLIC (default) or PRIVATE. PRIVATE is allowed only in organization workspaces and is immutable after create.",
    }),
    ...taskScheduleAssigneeFields,
    rule: taskScheduleRuleSchema,
  })
  .superRefine(refineAssigneeXorConflict)
  .openapi("CreateTaskScheduleRequest");

export const updateTaskScheduleRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative().openapi({
      description: "Revision observed by the caller; a newer one is a 409",
      example: 3,
    }),
    name: taskScheduleNameSchema.optional(),
    description: z.string().nullish(),
    projectId: z.string().uuid().nullish(),
    ...taskScheduleAssigneeFields,
    rule: taskScheduleRuleReplacementSchema.optional().openapi({
      description:
        "Replaces the whole rule; timezone and endsMode are required. Changes future Runs only; Tasks already created stay as they are.",
    }),
  })
  .superRefine(refineAssigneeXorConflict)
  .openapi("UpdateTaskScheduleRequest");

export const taskScheduleListQuerySchema = cursorPaginationQuerySchema.extend({
  projectId: z.string().uuid().optional(),
  state: taskScheduleStateSchema.optional(),
});

export const taskScheduleSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    organizationId: z.string().nullable(),
    ownerId: z.string(),
    creatorUserId: z.string().nullable(),
    creatorCoworkerId: z.string().nullable(),
    creatorSokoBotId: z.string().uuid().nullable(),
    state: taskScheduleStateSchema,
    rule: z.object({
      expr: z.string(),
      timezone: z.string(),
      intervalDays: z.number().int().nullable(),
      anchorAt: dateTimeSchema,
      endsMode: taskScheduleEndsModeSchema,
      endsOn: dateTimeSchema.nullable(),
      targetRunCount: z.number().int().nullable(),
    }),
    ruleEffectiveFrom: dateTimeSchema,
    releasedCount: z.number().int(),
    nextRunAt: dateTimeSchema.nullable(),
    revision: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    projectId: z.string().uuid().nullable(),
    visibility: taskVisibilitySchema,
    assigneeId: z.string().nullable(),
    assigneeSokoBotId: z.string().uuid().nullable(),
    assigneeUserId: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("TaskSchedule");

export const taskScheduleParamsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "01960001-0001-7001-8001-000000000042",
    }),
});

export const taskScheduleRunParamsSchema = taskScheduleParamsSchema.extend({
  runId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "runId", in: "path" },
      example: "01960001-0001-7001-8001-000000000043",
    }),
});

export const taskScheduleRunListQuerySchema =
  cursorPaginationQuerySchema.extend({
    from: dateTimeSchema.optional().openapi({
      param: { name: "from", in: "query" },
      description: "Only Runs at or after this time",
      example: "2026-10-01T00:00:00.000Z",
    }),
    to: dateTimeSchema.optional().openapi({
      param: { name: "to", in: "query" },
      description: "Only Runs before this time",
      example: "2026-11-01T00:00:00.000Z",
    }),
  });

/**
 * One Run of a Task Schedule. Its exceptions live on the row itself:
 * a skip is its state, a move is an effective time that differs from the
 * rule's, and the actor columns say who made the latest change.
 */
export const taskScheduleRunSchema = z
  .object({
    id: z.string().uuid(),
    state: z.enum(TaskScheduleRunState).openapi({
      description:
        "PLANNED (will create a Task), SKIPPED, RELEASED (created `releasedTaskId`), or CANCELED (dropped by a rule edit or by ending the schedule, or a move whose time passed while the schedule was Paused)",
      example: TaskScheduleRunState.PLANNED,
    }),
    originalScheduledAt: dateTimeSchema.nullable().openapi({
      description: "Time the rule planned",
    }),
    effectiveScheduledAt: dateTimeSchema.openapi({
      description: "Time the Run holds; differs from the rule when moved",
    }),
    releasedTaskId: z.string().nullable().openapi({
      description: "Task this Run created",
    }),
    actorUserId: z.string().nullable().openapi({
      description: "Person who last skipped, moved, or restored it",
    }),
    actorCoworkerId: z.string().nullable().openapi({
      description: "Coworker that last skipped, moved, or restored it",
    }),
    updatedAt: dateTimeSchema,
  })
  .openapi("TaskScheduleRun");

const runChangePrecondition = {
  expectedRevision: z.number().int().nonnegative().openapi({
    description: "Task Schedule revision observed by the caller",
    example: 3,
  }),
};

export const updateTaskScheduleRunRequestSchema = z
  .discriminatedUnion("action", [
    z.object({
      ...runChangePrecondition,
      action: z.literal("skip"),
    }),
    z.object({
      ...runChangePrecondition,
      action: z.literal("move"),
      scheduledAt: dateTimeSchema.openapi({
        description:
          "New time. Strictly future and inside the projection horizon.",
        example: "2026-10-02T09:00:00.000Z",
      }),
    }),
    z
      .object({
        ...runChangePrecondition,
        action: z.literal("restore"),
      })
      .openapi({
        description:
          "Puts a skipped or moved Run back at the rule's time, which must still be ahead.",
      }),
  ])
  .openapi("UpdateTaskScheduleRunRequest");

export const taskScheduleRunUpdateSchema = z
  .object({
    revision: z.number().int().nonnegative().openapi({
      description: "Task Schedule revision after the change",
      example: 4,
    }),
    run: taskScheduleRunSchema,
  })
  .openapi("TaskScheduleRunUpdate");

export type TaskScheduleRule = z.infer<typeof taskScheduleRuleSchema>;
export type TaskScheduleRunListQuery = z.infer<
  typeof taskScheduleRunListQuerySchema
>;
export type UpdateTaskScheduleRunRequest = z.infer<
  typeof updateTaskScheduleRunRequestSchema
>;
export type CreateTaskScheduleRequest = z.infer<
  typeof createTaskScheduleRequestSchema
>;
export type UpdateTaskScheduleRequest = z.infer<
  typeof updateTaskScheduleRequestSchema
>;
export type TaskScheduleListQuery = z.infer<typeof taskScheduleListQuerySchema>;
