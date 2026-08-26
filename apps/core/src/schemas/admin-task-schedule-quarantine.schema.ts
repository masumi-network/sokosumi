import { z } from "@hono/zod-openapi";

import { taskScheduleInputSchema } from "@/schemas/task-schedule.schema";

export const adminTaskScheduleQuarantineTaskIdParamSchema = z.object({
  taskId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "taskId", in: "path" },
      example: "0199292e-2743-7000-8000-000000000001",
    }),
});

const quarantineActionBaseSchema = z.object({
  operationId: z.string().uuid().openapi({
    description: "Idempotency identity for this operator action",
    example: "123e4567-e89b-42d3-a456-426614174000",
  }),
  reason: z.string().trim().min(1).max(1000).openapi({
    description: "Operator reason retained in the Task audit event",
    example: "Corrected an invalid imported timezone",
  }),
});

export const repairTaskScheduleQuarantineBodySchema = quarantineActionBaseSchema
  .extend({
    schedule: taskScheduleInputSchema,
  })
  .openapi("RepairTaskScheduleQuarantineBody");

export const removeTaskScheduleQuarantineBodySchema =
  quarantineActionBaseSchema.openapi("RemoveTaskScheduleQuarantineBody");

export const adminTaskScheduleQuarantineActionResultSchema = z
  .object({
    taskId: z.string(),
    eventId: z.string(),
    action: z.enum(["repaired", "removed"]),
    replayed: z.boolean(),
  })
  .openapi("AdminTaskScheduleQuarantineActionResult");
