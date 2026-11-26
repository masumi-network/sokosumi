import { createRoute, z } from "@hono/zod-openapi";
import { getEnv } from "@/config/env";
import { errorResponseWithExtensionsSchema } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { taskStatusSchema } from "@/schemas/domain-enums.schema";
import { taskEventSchema } from "@/schemas/task.schema";
import { taskWorkerContextSchema } from "@/schemas/task-worker-context.schema";
import {
  createTaskEventRequestSchema,
  seoSettlementFields,
  taskEventParamsSchema,
} from "./schema";
import { failedAdmissionSchema, startAdmissionSchema } from "./seo-admission";

export type TaskEventRouteMode =
  | "standard"
  | "context"
  | "failed-admission"
  | "start-admission"
  | "seo-settlement";

export function createTaskEventRoute(mode: TaskEventRouteMode) {
  const baseSchema = createTaskEventRequestSchema({
    serverNetwork: getEnv().NETWORK,
  });
  const endpoint = {
    standard: {
      path: "/{id}/events",
      description: "Create task event",
      schema: baseSchema,
    },
    context: {
      path: "/{id}/events/context-v1",
      description:
        "Create an assigned Coworker event only for the asserted owner, billing organization and Workspace",
      schema: baseSchema.and(
        z.object({ expectedContext: taskWorkerContextSchema }),
      ),
    },
    "seo-settlement": {
      path: "/{id}/events/seo-settlement-v1",
      description:
        "Settle a completed full audit once, using its approved price and verified API receipts.",
      schema: baseSchema.and(seoSettlementFields),
    },
    "start-admission": {
      path: "/{id}/events/start-admission-v1",
      description:
        "Start a waiting SEO Task only while its assigned worker, context, input and latest event still match.",
      schema: startAdmissionSchema,
    },
    "failed-admission": {
      path: "/{id}/events/failed-admission-v1",
      description:
        "Fail a waiting SEO Task when its assigned worker, workspace, input, and latest status event still match. This operation does not charge credits.",
      schema: failedAdmissionSchema,
    },
  } as const;
  const { path, description, schema } = endpoint[mode];

  const route = createRoute({
    method: "post",
    path,
    description,
    tags: ["Tasks"],
    request: {
      params: taskEventParamsSchema,
      body: {
        required:
          mode === "failed-admission" ||
          mode === "start-admission" ||
          undefined,
        content: {
          "application/json": {
            schema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(taskEventSchema, "Create task event"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422:
        mode === "start-admission" || mode === "failed-admission"
          ? jsonErrorResponse(
              mode === "start-admission"
                ? "Invalid start admission request, scope, or approved price"
                : "Invalid failed admission request",
            )
          : {
              description:
                "Unprocessable Entity. Branch on `kind`: insufficient_balance (mid-run balance shortfall pauses the task to OUT_OF_CREDITS; `data` is that event; may include `attemptedCredits` and `requestedStatus`), or queued_requires_run_at (Queued requested on a Task without a Run at; no pause event in `data`).",
              content: {
                "application/json": {
                  schema: errorResponseWithExtensionsSchema({
                    data: taskEventSchema.optional(),
                    attemptedCredits: z
                      .number()
                      .optional()
                      .openapi({ example: 2 }),
                    requestedStatus: z
                      .union([taskStatusSchema, z.null()])
                      .optional(),
                  }),
                },
              },
            },
      500: jsonErrorResponse("Internal Server Error"),
    },
  });

  return { baseSchema, route };
}
