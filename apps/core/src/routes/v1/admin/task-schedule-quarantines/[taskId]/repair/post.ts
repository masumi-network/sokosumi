import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireInteractiveAdminAuthContext } from "@/middleware/auth";
import {
  adminTaskScheduleQuarantineActionResultSchema,
  adminTaskScheduleQuarantineTaskIdParamSchema,
  repairTaskScheduleQuarantineBodySchema,
} from "@/schemas/admin-task-schedule-quarantine.schema";
import { repairTaskScheduleQuarantine } from "@/services/task-schedule-quarantine.service";
import { unwrapTaskScheduleQuarantineAction } from "../../action-result.js";

const route = createRoute({
  method: "post",
  path: "/{taskId}/repair",
  operationId: "repairAdminTaskScheduleQuarantine",
  description:
    "Replace malformed schedule data with a validated v1 schedule, clear quarantine, and append an audited Task event. Requires an interactive admin session.",
  tags: ["Admin"],
  request: {
    params: adminTaskScheduleQuarantineTaskIdParamSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: repairTaskScheduleQuarantineBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminTaskScheduleQuarantineActionResultSchema,
      "Task schedule quarantine repaired",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { taskId } = c.req.valid("param");
    const body = c.req.valid("json");
    const operator = requireInteractiveAdminAuthContext(c.var.authContext);
    const result = unwrapTaskScheduleQuarantineAction(
      await repairTaskScheduleQuarantine({
        taskId,
        operationId: body.operationId,
        operatorId: operator.userId,
        reason: body.reason,
        schedule: body.schedule,
      }),
    );

    return ok(
      c,
      adminTaskScheduleQuarantineActionResultSchema.parse({
        taskId: result.taskId,
        eventId: result.eventId,
        action: result.status,
        replayed: result.replayed,
      }),
    );
  });
}
