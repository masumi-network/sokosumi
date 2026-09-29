import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { sokoBotTurnSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapControlPlaneError, mapTurn, turnParams } from "../../../helpers.js";

const getTurnRoute = createRoute({
  method: "get",
  path: "/me/turns/{turnId}",
  operationId: "getMySokoBotTurn",
  tags: ["Soko Bots"],
  request: { params: turnParams },
  responses: {
    200: jsonSuccessResponse(sokoBotTurnSchema, "Get Soko Bot turn"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getTurnRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    try {
      const turn = await sokoBotControlPlane.getTurn(
        auth.userId,
        c.req.valid("param").turnId,
      );
      return ok(c, sokoBotTurnSchema.parse(mapTurn(turn)));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}
