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
  });

export const putTaskScheduleRequestSchema = z
  .discriminatedUnion("mode", [
    taskScheduleOnceInputSchema,
    taskScheduleRecurringInputSchema,
  ])
  .openapi("PutTaskScheduleRequest");

export type PutTaskScheduleRequest = z.infer<
  typeof putTaskScheduleRequestSchema
>;
