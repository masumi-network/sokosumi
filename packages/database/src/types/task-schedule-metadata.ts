import { z } from "zod";

const isoDateTimeSchema = z.iso.datetime();

const taskScheduleMetadataBaseSchema = z.object({
  version: z.literal(1),
  scheduledAt: isoDateTimeSchema,
  lastRunAt: isoDateTimeSchema.optional(),
});

export const taskScheduleOnceMetadataSchema =
  taskScheduleMetadataBaseSchema.extend({
    mode: z.literal("once"),
    runAt: isoDateTimeSchema,
  });

export const taskScheduleRecurringMetadataSchema =
  taskScheduleMetadataBaseSchema.extend({
    mode: z.literal("recurring"),
    expr: z.string().min(1),
    timezone: z.string().default("UTC"),
    endsMode: z.enum(["never", "on", "after"]).default("never"),
    endsOn: isoDateTimeSchema.optional(),
    occurrences: z.number().int().positive().optional(),
    intervalDays: z.number().int().positive().optional(),
    anchorAt: isoDateTimeSchema.optional(),
  });

export const taskScheduleMetadataSchema = z
  .discriminatedUnion("mode", [
    taskScheduleOnceMetadataSchema,
    taskScheduleRecurringMetadataSchema,
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

export type TaskScheduleMetadata = z.infer<typeof taskScheduleMetadataSchema>;
