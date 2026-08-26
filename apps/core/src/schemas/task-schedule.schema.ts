import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

const taskScheduleOnceInputSchema = z.object({
  mode: z.literal("once"),
  runAt: dateTimeSchema.openapi({
    description: "When the one-time schedule should run",
    example: "2026-06-24T09:00:00.000Z",
  }),
});

const taskScheduleRecurringInputSchema = z
  .object({
    mode: z.literal("recurring"),
    expr: z.string().min(1).openapi({
      description: "Cron expression for recurring runs",
      example: "0 9 * * *",
    }),
    timezone: z.string().default("UTC").openapi({
      description: "IANA timezone for the cron expression",
      example: "America/New_York",
    }),
    endsMode: z
      .enum(["never", "on", "after"])
      .default("never")
      .openapi({ example: "never" }),
    endsOn: dateTimeSchema.optional().openapi({
      description: "End date when endsMode is on",
      example: "2026-12-31T23:59:59.000Z",
    }),
    occurrences: z.number().int().positive().optional().openapi({
      description: "Remaining occurrences when endsMode is after",
      example: 10,
    }),
    intervalDays: z.number().int().positive().optional().openapi({
      description:
        "When greater than 1, run every N calendar days from anchorAt instead of using day-of-month cron steps",
      example: 2,
    }),
    anchorAt: dateTimeSchema.optional().openapi({
      description:
        "First run instant for intervalDays schedules (required when intervalDays > 1)",
      example: "2026-06-24T09:00:00.000Z",
    }),
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

export const taskScheduleInputSchema = z
  .discriminatedUnion("mode", [
    taskScheduleOnceInputSchema,
    taskScheduleRecurringInputSchema,
  ])
  .openapi("TaskScheduleInput");

const operationAwareTaskScheduleRequestSchema = z.object({
  operationId: z.string().uuid().openapi({
    description: "Idempotency identity for this series edit",
    example: "123e4567-e89b-42d3-a456-426614174000",
  }),
  expectedScheduleRevision: z.number().int().nonnegative().openapi({
    description: "Schedule revision observed by the caller",
    example: 3,
  }),
  discardFutureExceptions: z.literal(true).openapi({
    description: "Confirms that future occurrence exceptions may be canceled",
    example: true,
  }),
  schedule: taskScheduleInputSchema,
});

export const putTaskScheduleRequestSchema = z
  .union([operationAwareTaskScheduleRequestSchema, taskScheduleInputSchema])
  .openapi("PutTaskScheduleRequest");

export type TaskScheduleInput = z.infer<typeof taskScheduleInputSchema>;

export type PutTaskScheduleRequest = z.infer<
  typeof putTaskScheduleRequestSchema
>;

export function getTaskScheduleInput(
  request: PutTaskScheduleRequest,
): TaskScheduleInput {
  return "schedule" in request ? request.schedule : request;
}
