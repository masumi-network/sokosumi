import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapControlPlaneError, turnParams } from "../../../../helpers.js";

const cancelTurnRoute = createRoute({
  method: "post",
  path: "/me/turns/{turnId}/cancel",
  operationId: "cancelMySokoBotTurn",
  tags: ["Soko Bots"],
  request: { params: turnParams },
  responses: {
    200: jsonSuccessResponse(
      z.object({ cancellationRequested: z.literal(true) }),
      "Cancel requested",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(cancelTurnRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    try {
      await sokoBotControlPlane.cancelTurn(
        auth.userId,
        c.req.valid("param").turnId,
      );
      return ok(c, { cancellationRequested: true as const });
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}
