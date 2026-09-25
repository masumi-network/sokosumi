import { z } from "@hono/zod-openapi";
import { TaskScheduleEndsMode } from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { dateTimeSchema } from "@/helpers/datetime";
import { refineAssigneeXorConflict } from "@/helpers/task-assignee-alias";
import { taskVisibilitySchema } from "@/schemas/domain-enums.schema";

/**
 * Temporary. Remove after 2026-09-29 with the per-Task schedule shim.
 * Request shapes the old `/tasks/scheduled` and `/{id}/schedule` clients sent.
 */

export const legacyEndsModeSchema = z
  .enum(["never", "on", "after"])
  .openapi("LegacyTaskScheduleEndsMode");

const legacyOnceScheduleSchema = z.object({
  mode: z.literal("once"),
  runAt: dateTimeSchema,
});

const legacyRecurringScheduleSchema = z
  .object({
    mode: z.literal("recurring"),
    expr: z.string().min(1),
    timezone: z.string().min(1).default("UTC"),
    endsMode: legacyEndsModeSchema.default("never"),
    endsOn: dateTimeSchema.optional(),
    occurrences: z.number().int().positive().optional(),
    intervalDays: z.number().int().positive().optional(),
    anchorAt: dateTimeSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.endsMode === "on" && !data.endsOn) {
      ctx.addIssue({
        code: "custom",
        message: "endsOn is required when endsMode is on",
        path: ["endsOn"],
      });
    }
    if (data.endsMode === "after" && data.occurrences == null) {
      ctx.addIssue({
        code: "custom",
        message: "occurrences is required when endsMode is after",
        path: ["occurrences"],
      });
    }
    if (data.intervalDays != null && data.intervalDays > 1 && !data.anchorAt) {
      ctx.addIssue({
        code: "custom",
        message: "anchorAt is required when intervalDays is greater than 1",
        path: ["anchorAt"],
      });
    }
  });

export const legacyTaskScheduleInputSchema = z
  .discriminatedUnion("mode", [
    legacyOnceScheduleSchema,
    legacyRecurringScheduleSchema,
  ])
  .openapi("LegacyTaskScheduleInput");

export const legacyCalendarSourceSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("workspace") }),
    z.object({
      type: z.literal("project"),
      projectId: z.string().uuid(),
    }),
  ])
  .openapi("LegacyCalendarTaskScheduleSource");

export const legacyCreateScheduledTaskRequestSchema = z
  .object({
    operationId: z.string().uuid().optional(),
    source: legacyCalendarSourceSchema,
    name: z.string().trim().min(1).max(LIMITS.NAME_MAX_LENGTH),
    description: z.string().nullish(),
    assigneeId: z.string().min(1).nullish(),
    assigneeSokoBotId: z.string().uuid().nullish(),
    assigneeUserId: z.string().min(1).nullish(),
    schedule: legacyTaskScheduleInputSchema,
  })
  .superRefine(refineAssigneeXorConflict)
  .openapi("LegacyCreateScheduledTaskRequest");

export const legacyPutTaskScheduleRequestSchema =
  legacyTaskScheduleInputSchema.openapi("LegacyPutTaskScheduleRequest");

export const legacyPutCalendarTaskScheduleRequestSchema = z
  .object({
    operationId: z.string().uuid().optional(),
    expectedScheduleRevision: z.number().int().nonnegative(),
    discardFutureExceptions: z.literal(true),
    schedule: legacyTaskScheduleInputSchema,
  })
  .openapi("LegacyPutCalendarTaskScheduleRequest");

export const legacyPutCalendarSourceRequestSchema = z
  .object({
    operationId: z.string().uuid().optional(),
    expectedScheduleRevision: z.number().int().nonnegative(),
    discardFutureExceptions: z.literal(true),
    source: legacyCalendarSourceSchema,
  })
  .openapi("LegacyPutCalendarTaskScheduleSourceRequest");

const legacyEndsModeFromNew: Record<
  TaskScheduleEndsMode,
  z.infer<typeof legacyEndsModeSchema>
> = {
  [TaskScheduleEndsMode.NEVER]: "never",
  [TaskScheduleEndsMode.ON]: "on",
  [TaskScheduleEndsMode.AFTER]: "after",
};

export const legacyTaskScheduleProjectionSchema = z
  .object({
    id: z.string().uuid(),
    scheduleId: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    projectId: z.string().uuid().nullable(),
    visibility: taskVisibilitySchema,
    assigneeId: z.string().nullable(),
    assigneeSokoBotId: z.string().uuid().nullable(),
    nextRunAt: dateTimeSchema.nullable(),
    scheduleRevision: z.number().int(),
    schedule: z.object({
      mode: z.literal("recurring"),
      expr: z.string(),
      timezone: z.string(),
      endsMode: legacyEndsModeSchema,
      endsOn: dateTimeSchema.nullable().optional(),
      occurrences: z.number().int().nullable().optional(),
      intervalDays: z.number().int().nullable().optional(),
      anchorAt: dateTimeSchema.nullable().optional(),
    }),
  })
  .openapi("LegacyTaskScheduleProjection");

export function legacyEndsModeFromTaskSchedule(
  endsMode: TaskScheduleEndsMode,
): z.infer<typeof legacyEndsModeSchema> {
  return legacyEndsModeFromNew[endsMode];
}

export type LegacyTaskScheduleInput = z.infer<
  typeof legacyTaskScheduleInputSchema
>;
export type LegacyCreateScheduledTaskRequest = z.infer<
  typeof legacyCreateScheduledTaskRequestSchema
>;
export type LegacyPutCalendarSourceRequest = z.infer<
  typeof legacyPutCalendarSourceRequestSchema
>;
