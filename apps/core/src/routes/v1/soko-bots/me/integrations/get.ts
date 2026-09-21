import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotIntegrationsSchema } from "@/schemas/soko-bot.schema";
import { listSokoBotIntegrations } from "@/services/soko-bot-integrations.service";
import { mapIntegrationError } from "../../helpers.js";

const listIntegrationsRoute = createRoute({
  method: "get",
  path: "/me/integrations",
  operationId: "listMySokoBotIntegrations",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotIntegrationsSchema,
      "Every provider with the bot's connection state",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listIntegrationsRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const result = await listSokoBotIntegrations(
        auth.userId,
        workspace.workspaceId,
      );
      return ok(c, sokoBotIntegrationsSchema.parse(result));
    } catch (error) {
      mapIntegrationError(error);
    }
  });
}
