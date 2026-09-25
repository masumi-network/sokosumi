import { z } from "@hono/zod-openapi";
import { type TaskSchedule, TaskScheduleEndsMode } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime";
import { formatZodErrorMessage } from "@/helpers/error";
import {
  type CreateTaskScheduleRequest,
  createTaskScheduleRequestSchema,
  type TaskScheduleRule,
  taskScheduleRuleReplacementSchema,
  type UpdateTaskScheduleRequest,
} from "@/schemas/task-schedule.schema";

import { throwUnmappable } from "./vendor";

export const NEW_CREATE = "POST /v1/tasks/schedules";
export const NEW_PATCH = "PATCH /v1/tasks/schedules/{id}";
export const NEW_TASK_CREATE = "POST /v1/tasks";

/** The body the old `PUT /v1/tasks/{id}/schedule` took. */
export const legacyScheduleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("once"), runAt: dateTimeSchema }),
  z
    .object({
      mode: z.literal("recurring"),
      expr: z.string().min(1),
      timezone: z.string().min(1).default("UTC"),
      endsMode: z.enum(["never", "on", "after"]).default("never"),
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
      if (
        data.intervalDays != null &&
        data.intervalDays > 1 &&
        !data.anchorAt
      ) {
        ctx.addIssue({
          code: "custom",
          message: "anchorAt is required when intervalDays is greater than 1",
          path: ["anchorAt"],
        });
      }
    }),
]);

export type LegacySchedule = z.infer<typeof legacyScheduleSchema>;
export type LegacyRecurringSchedule = Extract<
  LegacySchedule,
  { mode: "recurring" }
>;
export type LegacyOnceSchedule = Extract<LegacySchedule, { mode: "once" }>;

const ENDS_MODE_TO_NEW = {
  never: TaskScheduleEndsMode.NEVER,
  on: TaskScheduleEndsMode.ON,
  after: TaskScheduleEndsMode.AFTER,
} as const;

const ENDS_MODE_TO_LEGACY = {
  [TaskScheduleEndsMode.NEVER]: "never",
  [TaskScheduleEndsMode.ON]: "on",
  [TaskScheduleEndsMode.AFTER]: "after",
} as const;

/**
 * The old API had no paused state, so these clients pause a schedule by
 * moving it to a one-time run on this date, and read it back to tell a
 * paused schedule from a live one.
 */
export const LEGACY_HOLD_RUN_AT = "2099-12-31T23:59:00.000Z";

export function isLegacyHold(schedule: LegacyOnceSchedule): boolean {
  return new Date(schedule.runAt)
    .toISOString()
    .startsWith(LEGACY_HOLD_RUN_AT.slice(0, 10));
}

const LEGACY_INTERVAL_DAYS_CRON = /^(\d+) (\d+) \*\/(\d+) \* \*$/;

/**
 * The old release, and the cutover after it, read an `M H *\/N * *` cron
 * with no `intervalDays` as every N days from the rule write.
 */
function legacyIntervalDays(schedule: LegacyRecurringSchedule): {
  intervalDays: number | undefined;
  inferred: boolean;
} {
  if (schedule.intervalDays != null && schedule.intervalDays > 1) {
    return { intervalDays: schedule.intervalDays, inferred: false };
  }
  const days = Number(
    LEGACY_INTERVAL_DAYS_CRON.exec(schedule.expr.trim())?.[3],
  );
  return days > 1
    ? { intervalDays: days, inferred: true }
    : { intervalDays: schedule.intervalDays, inferred: false };
}

/**
 * Old `occurrences` counted the Runs still to come from the rule write on,
 * while `targetRunCount` counts every Run the schedule releases.
 */
export function mapRecurringRule(
  schedule: LegacyRecurringSchedule,
  releasedCount = 0,
): TaskScheduleRule {
  const endsMode = ENDS_MODE_TO_NEW[schedule.endsMode];
  const { intervalDays, inferred } = legacyIntervalDays(schedule);
  return {
    expr: schedule.expr,
    timezone: schedule.timezone,
    intervalDays,
    anchorAt:
      schedule.anchorAt ?? (inferred ? new Date().toISOString() : undefined),
    endsMode,
    endsOn: endsMode === TaskScheduleEndsMode.ON ? schedule.endsOn : undefined,
    targetRunCount:
      endsMode === TaskScheduleEndsMode.AFTER && schedule.occurrences != null
        ? releasedCount + schedule.occurrences
        : undefined,
  };
}

function remainingOccurrences(schedule: TaskSchedule): number | null {
  return schedule.targetRunCount == null
    ? null
    : schedule.targetRunCount - schedule.releasedCount;
}

function sameInstant(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined,
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * The old PUT kept the rule, its epoch, and its exceptions when the body
 * matched it, so a client re-sending its rule changed nothing.
 */
export function legacyRuleMatches(
  current: TaskSchedule,
  schedule: LegacyRecurringSchedule,
): boolean {
  const rule = mapRecurringRule(schedule);
  const intervalDays = rule.intervalDays ?? null;
  return (
    rule.expr === current.expr &&
    rule.timezone === current.timezone &&
    rule.endsMode === current.endsMode &&
    sameInstant(rule.endsOn, current.endsOn) &&
    (rule.targetRunCount ?? null) === remainingOccurrences(current) &&
    intervalDays === current.intervalDays &&
    (intervalDays == null ||
      intervalDays <= 1 ||
      schedule.anchorAt == null ||
      sameInstant(schedule.anchorAt, current.anchorAt))
  );
}

/** A rule replacement; the old PUT sent no revision, so it takes the current one. */
export function mapLegacyRuleToUpdate(
  schedule: LegacyRecurringSchedule,
  current: TaskSchedule,
): UpdateTaskScheduleRequest {
  const parsed = taskScheduleRuleReplacementSchema.safeParse(
    mapRecurringRule(schedule, current.releasedCount),
  );
  if (!parsed.success) {
    throwUnmappable(
      `${formatZodErrorMessage(parsed.error)}. Use the typed rule on ${NEW_PATCH}.`,
      NEW_PATCH,
    );
  }
  return { expectedRevision: current.revision, rule: parsed.data };
}

export function parseMappedCreate(
  input: CreateTaskScheduleRequest,
): CreateTaskScheduleRequest {
  const parsed = createTaskScheduleRequestSchema.safeParse(input);
  if (!parsed.success) {
    throwUnmappable(
      `${formatZodErrorMessage(parsed.error)}. Use the typed rule on ${NEW_CREATE}.`,
      NEW_CREATE,
    );
  }
  return parsed.data;
}

/** A schedule's rule as the old API stored it in the template's `metadata`. */
export function legacyRecurringSpec(schedule: TaskSchedule) {
  return {
    mode: "recurring",
    expr: schedule.expr,
    timezone: schedule.timezone,
    endsMode: ENDS_MODE_TO_LEGACY[schedule.endsMode],
    ...(schedule.endsOn ? { endsOn: schedule.endsOn.toISOString() } : {}),
    ...(schedule.targetRunCount != null
      ? { occurrences: remainingOccurrences(schedule) }
      : {}),
    ...(schedule.intervalDays != null
      ? {
          intervalDays: schedule.intervalDays,
          anchorAt: schedule.anchorAt.toISOString(),
        }
      : {}),
  };
}
