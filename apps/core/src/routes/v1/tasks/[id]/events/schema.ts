import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

export const createTaskEventRequestSchema = z
  .object({
    status: z
      .enum(TaskStatus)
      .optional()
      .openapi({ example: TaskStatus.RUNNING }),
    comment: z
      .string()
      .optional()
      .openapi({ example: "Task Event is running" }),
    credits: z.number().min(0).finite().optional().openapi({ example: 5 }),
  })
  .superRefine((data, ctx) => {
    if (data.status === undefined && data.comment === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "At least one of status or comment is required",
        path: ["status", "comment"],
      });
    }

    if (data.status === TaskStatus.COMPLETED) {
      if (data.credits === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "Credits are required when completing a task",
          path: ["credits"],
        });
      }
    } else {
      if (data.credits !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "Credits can only be set when completing a task",
          path: ["credits"],
        });
      }
    }
  });
