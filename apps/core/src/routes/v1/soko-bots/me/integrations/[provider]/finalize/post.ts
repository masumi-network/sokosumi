import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { finalizeSokoBotIntegrationResponseSchema } from "@/schemas/soko-bot.schema";
import { finalizeSokoBotIntegration } from "@/services/soko-bot-integrations.service";
import {
  mapIntegrationError,
  providerParamSchema,
} from "../../../../helpers.js";

const finalizeIntegrationRoute = createRoute({
  method: "post",
  path: "/me/integrations/{provider}/finalize",
  operationId: "finalizeMySokoBotIntegration",
  tags: ["Soko Bots"],
  request: { params: providerParamSchema },
  responses: {
    200: jsonSuccessResponse(
      finalizeSokoBotIntegrationResponseSchema,
      "Connection state after the OAuth round-trip",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(finalizeIntegrationRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const status = await finalizeSokoBotIntegration({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        provider: c.req.valid("param").provider,
      });
      return ok(c, finalizeSokoBotIntegrationResponseSchema.parse({ status }));
    } catch (error) {
      mapIntegrationError(error);
    }
  });
}
