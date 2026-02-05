import { z } from "@hono/zod-openapi";
import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";

const TASK_EVENT_ORIGINS = Object.values(TaskEventOrigin) as TaskEventOrigin[];

const taskEventOriginSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toUpperCase();
      return TASK_EVENT_ORIGINS.includes(normalized as TaskEventOrigin)
        ? (normalized as TaskEventOrigin)
        : TaskEventOrigin.UNKNOWN;
    }

    return TaskEventOrigin.UNKNOWN;
  },
  z
    .enum(TASK_EVENT_ORIGINS as [TaskEventOrigin, ...TaskEventOrigin[]])
    .nullable(),
);

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
    authenticationUrl: z
      .httpUrl()
      .optional()
      .openapi({ example: "https://example.com/oauth/authorize" }),
    credits: z.number().min(0).optional().openapi({ example: 5 }),
    origin: taskEventOriginSchema.optional().openapi({
      example: TaskEventOrigin.SLACK,
      description:
        "The origin of the task event is considered to be generated on Sokosumi if it is not provided.",
    }),
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

    if (data.status === TaskStatus.AUTHENTICATION_REQUIRED) {
      if (!data.authenticationUrl) {
        ctx.addIssue({
          code: "custom",
          message: "authenticationUrl is required for authentication requests",
          path: ["authenticationUrl"],
        });
      } else if (!data.authenticationUrl.startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          message: "authenticationUrl must be an https URL",
          path: ["authenticationUrl"],
        });
      }
    } else if (data.authenticationUrl !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "authenticationUrl is only allowed for authentication requests",
        path: ["authenticationUrl"],
      });
    }
  });
