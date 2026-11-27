import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requirePreprodAccessOperator } from "@/helpers/preprod-access";
import { setPreprodPaused } from "@/helpers/preprod-control";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminPreprodPauseSchema,
  setAdminPreprodPauseBodySchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "put",
  path: "/preprod/pause",
  operationId: "setAdminPreprodPause",
  description:
    "Pause or open Preprod, with a reason. Records who changed it and why; a value it already has changes and records nothing. Requires an interactive admin session that is not impersonating.",
  tags: ["Admin"],
  request: {
    body: {
      // Without this, a request with no body skips validation and reaches
      // the handler without the mandatory reason.
      required: true,
      content: {
        "application/json": {
          schema: setAdminPreprodPauseBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminPreprodPauseSchema,
      "The Preprod pause, its generation and its recent changes",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity - validation failed"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const operator = requirePreprodAccessOperator(c.var.authContext);
    const { paused, reason } = c.req.valid("json");

    return ok(
      c,
      adminPreprodPauseSchema.parse(
        await setPreprodPaused({
          paused,
          operatorId: operator.userId,
          reason,
        }),
      ),
    );
  });
}
