import { z } from "zod";

const isoDateTimeSchema = z.iso.datetime();

const taskScheduleMetadataV1BaseSchema = z.object({
  version: z.literal(1),
  scheduledAt: isoDateTimeSchema,
  lastRunAt: isoDateTimeSchema.optional(),
});

const taskScheduleOnceMetadataV1Schema =
  taskScheduleMetadataV1BaseSchema.extend({
    mode: z.literal("once"),
    runAt: isoDateTimeSchema,
  });

const taskScheduleRecurringMetadataV1Schema =
  taskScheduleMetadataV1BaseSchema.extend({
    mode: z.literal("recurring"),
    expr: z.string().min(1),
    timezone: z.string().min(1).default("UTC"),
    endsMode: z.enum(["never", "on", "after"]).default("never"),
    endsOn: isoDateTimeSchema.optional(),
    occurrences: z.number().int().positive().optional(),
    intervalDays: z.number().int().positive().optional(),
    anchorAt: isoDateTimeSchema.optional(),
  });

const taskScheduleMetadataV1Schema = z
  .discriminatedUnion("mode", [
    taskScheduleOnceMetadataV1Schema,
    taskScheduleRecurringMetadataV1Schema,
  ])
  .superRefine((data, ctx) => {
    if (data.mode !== "recurring") {
      return;
    }

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
  });

const taskScheduleMetadataV2BaseSchema = z.object({
  version: z.literal(2),
  epochId: z.uuid(),
  createdAt: isoDateTimeSchema,
  ruleEffectiveFrom: isoDateTimeSchema,
  timezone: z.string().min(1),
  lastProcessedSourceAt: isoDateTimeSchema.optional(),
});

export const taskScheduleOnceMetadataV2Schema =
  taskScheduleMetadataV2BaseSchema.extend({
    mode: z.literal("once"),
    sourceRunAt: isoDateTimeSchema,
    effectiveRunAt: isoDateTimeSchema,
  });

export const taskScheduleRecurringMetadataV2Schema =
  taskScheduleMetadataV2BaseSchema.extend({
    mode: z.literal("recurring"),
    expr: z.string().min(1),
    endsMode: z.enum(["never", "on", "after"]),
    endsOn: isoDateTimeSchema.optional(),
    targetReleaseCount: z.number().int().positive().optional(),
    epochReleaseCount: z.number().int().nonnegative(),
    intervalDays: z.number().int().positive().optional(),
    anchorAt: isoDateTimeSchema,
  });

export const taskScheduleMetadataV2Schema = z
  .discriminatedUnion("mode", [
    taskScheduleOnceMetadataV2Schema,
    taskScheduleRecurringMetadataV2Schema,
  ])
  .superRefine((data, ctx) => {
    if (data.mode !== "recurring") {
      return;
    }

    if (data.endsMode === "on" && !data.endsOn) {
      ctx.addIssue({
        code: "custom",
        message: "endsOn is required when endsMode is on",
        path: ["endsOn"],
      });
    }

    if (data.endsMode === "never" && data.endsOn != null) {
      ctx.addIssue({
        code: "custom",
        message: "endsOn is not allowed when endsMode is never",
        path: ["endsOn"],
      });
    }

    if (data.endsMode !== "after" && data.targetReleaseCount != null) {
      ctx.addIssue({
        code: "custom",
        message: "targetReleaseCount is allowed only when endsMode is after",
        path: ["targetReleaseCount"],
      });
    }

    if (data.endsMode === "after" && data.endsOn != null) {
      ctx.addIssue({
        code: "custom",
        message: "endsOn is not allowed when endsMode is after",
        path: ["endsOn"],
      });
    }

    if (data.endsMode === "after" && data.targetReleaseCount == null) {
      ctx.addIssue({
        code: "custom",
        message: "targetReleaseCount is required when endsMode is after",
        path: ["targetReleaseCount"],
      });
    }

    if (
      data.targetReleaseCount != null &&
      data.epochReleaseCount > data.targetReleaseCount
    ) {
      ctx.addIssue({
        code: "custom",
        message: "epochReleaseCount cannot exceed targetReleaseCount",
        path: ["epochReleaseCount"],
      });
    }
  });

export const taskScheduleMetadataSchema = z.union([
  taskScheduleMetadataV1Schema,
  taskScheduleMetadataV2Schema,
]);

export type TaskScheduleMetadataV1 = z.infer<
  typeof taskScheduleMetadataV1Schema
>;
export type TaskScheduleMetadataV2 = z.infer<
  typeof taskScheduleMetadataV2Schema
>;
export type TaskScheduleMetadata = z.infer<typeof taskScheduleMetadataSchema>;

export function hasReachedTaskScheduleReleaseTarget(
  metadata: Extract<TaskScheduleMetadata, { mode: "recurring" }>,
): boolean {
  if (metadata.endsMode !== "after") {
    return false;
  }

  return metadata.version === 1
    ? metadata.occurrences != null && metadata.occurrences <= 0
    : metadata.targetReleaseCount != null &&
        metadata.epochReleaseCount >= metadata.targetReleaseCount;
}

export function parseTaskScheduleMetadata(
  metadata: string | null | undefined,
): TaskScheduleMetadata | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = taskScheduleMetadataSchema.safeParse(JSON.parse(metadata));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function hasTaskScheduleMetadataShape(
  metadata: string | null | undefined,
): boolean {
  if (!metadata) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== "object") {
      return false;
    }

    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 && record.version !== 2) {
      return false;
    }

    return record.mode === "once" || record.mode === "recurring";
  } catch {
    return false;
  }
}

/**
 * Whether a task currently has an active schedule (metadata or nextRunAt).
 * The structural metadata check intentionally stays conservative so known
 * schedule versions remain protected even if a row needs operator repair.
 */
export function hasActiveTaskSchedule(
  metadata: string | null | undefined,
  nextRunAt: Date | string | null | undefined,
): boolean {
  return hasTaskScheduleMetadataShape(metadata) || Boolean(nextRunAt);
}
