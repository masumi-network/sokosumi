import { z } from "@hono/zod-openapi";
import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";

import { isCreditableTaskStatus } from "./helper";

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
    credits: z.number().positive().nullish().openapi({ example: 5 }),
    origin: z
      .enum(TaskEventOrigin)
      .optional()
      .default(TaskEventOrigin.SOKOSUMI)
      .openapi({
        example: TaskEventOrigin.SLACK,
        description:
          "The origin of the task event. Defaults to SOKOSUMI if undefined.",
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

    if (!isCreditableTaskStatus(data.status) && data.credits != null) {
      ctx.addIssue({
        code: "custom",
        message:
          "Credits can only be set when completing, canceling, or marking that the user is out of credits",
        path: ["credits"],
      });
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
