import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireInteractiveAdminAuthContext } from "@/middleware/auth";
import {
  adminTaskScheduleQuarantineActionResultSchema,
  adminTaskScheduleQuarantineTaskIdParamSchema,
  removeTaskScheduleQuarantineBodySchema,
} from "@/schemas/admin-task-schedule-quarantine.schema";
import { removeTaskScheduleQuarantine } from "@/services/task-schedule-quarantine.service";
import { unwrapTaskScheduleQuarantineAction } from "../../action-result.js";

const route = createRoute({
  method: "post",
  path: "/{taskId}/remove",
  operationId: "removeAdminTaskScheduleQuarantine",
  description:
    "Explicitly remove a malformed schedule, return the template to Draft, clear quarantine, and append an audited Task event. Requires an interactive admin session.",
  tags: ["Admin"],
  request: {
    params: adminTaskScheduleQuarantineTaskIdParamSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: removeTaskScheduleQuarantineBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminTaskScheduleQuarantineActionResultSchema,
      "Quarantined Task schedule removed",
    ),
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
      await removeTaskScheduleQuarantine({
        taskId,
        operationId: body.operationId,
        operatorId: operator.userId,
        reason: body.reason,
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
