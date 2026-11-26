import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { redactAdminPresentation } from "@/lib/soko-bot/admin-action-record";
import { requireAdminAuthContext } from "@/middleware/auth";
import { turnParams } from "@/routes/v1/soko-bots/helpers";
import { sokoBotTurnSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapError } from "../../helpers.js";

const route = createRoute({
  method: "get",
  path: "/turns/{turnId}",
  operationId: "getAdminSokoBotTurn",
  tags: ["Admin"],
  description: "Read one turn of the admin's own bot for the scenario lab.",
  request: { params: turnParams },
  responses: {
    200: jsonSuccessResponse(
      sokoBotTurnSchema,
      "Scenario lab turn diagnostics",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const auth = requireAdminAuthContext(c.var.authContext);
    const { turnId } = c.req.valid("param");
    try {
      const turn = await sokoBotControlPlane.getTurn(auth.userId, turnId);
      c.header("Cache-Control", "no-store");
      return ok(c, redactAdminPresentation(sokoBotTurnSchema.parse(turn)));
    } catch (error) {
      mapError(error);
    }
  });
}
