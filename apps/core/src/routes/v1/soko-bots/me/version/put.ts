import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole, requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  sokoBotSchema,
  updateSokoBotVersionRequestSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapBot, mapControlPlaneError } from "../../helpers.js";

const updateVersionRoute = createRoute({
  method: "put",
  path: "/me/version",
  operationId: "updateMySokoBotVersion",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: updateSokoBotVersionRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Bot with the new version"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(updateVersionRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      await sokoBotControlPlane.updateVersion(
        auth.userId,
        workspace.workspaceId,
        c.req.valid("json").versionId,
        { allowUnpromoted: hasAdminRole(auth.role) },
      );
    } catch (error) {
      mapControlPlaneError(error);
    }
    const refreshed = await sokoBotControlPlane.getForUser(
      auth.userId,
      workspace.workspaceId,
    );
    return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
  });
}
