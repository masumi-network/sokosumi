import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { disconnectSokoBotIntegration } from "@/services/soko-bot-integrations.service";
import { mapIntegrationError, providerParamSchema } from "../../../helpers.js";

const disconnectIntegrationRoute = createRoute({
  method: "delete",
  path: "/me/integrations/{provider}",
  operationId: "disconnectMySokoBotIntegration",
  tags: ["Soko Bots"],
  request: { params: providerParamSchema },
  responses: {
    200: jsonSuccessResponse(
      z.object({ disconnected: z.literal(true) }),
      "Disconnected",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(disconnectIntegrationRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      await disconnectSokoBotIntegration({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        provider: c.req.valid("param").provider,
      });
      return ok(c, { disconnected: true as const });
    } catch (error) {
      mapIntegrationError(error);
    }
  });
}
