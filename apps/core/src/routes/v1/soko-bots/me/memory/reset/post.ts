import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotMemorySchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapControlPlaneError } from "../../../helpers.js";

const resetMemoryRoute = createRoute({
  method: "post",
  path: "/me/memory/reset",
  operationId: "resetMySokoBotMemory",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotMemorySchema, "Reset Soko Bot memory"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(resetMemoryRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const memory = await sokoBotControlPlane.resetMemory(
        auth.userId,
        workspace.workspaceId,
      );
      return ok(c, sokoBotMemorySchema.parse(memory));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}
