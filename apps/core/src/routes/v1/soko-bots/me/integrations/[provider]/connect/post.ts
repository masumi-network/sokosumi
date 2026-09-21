import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  connectSokoBotIntegrationRequestSchema,
  connectSokoBotIntegrationResponseSchema,
} from "@/schemas/soko-bot.schema";
import { connectSokoBotIntegration } from "@/services/soko-bot-integrations.service";
import {
  mapIntegrationError,
  providerParamSchema,
} from "../../../../helpers.js";

const connectIntegrationRoute = createRoute({
  method: "post",
  path: "/me/integrations/{provider}/connect",
  operationId: "connectMySokoBotIntegration",
  tags: ["Soko Bots"],
  request: {
    params: providerParamSchema,
    body: {
      content: {
        "application/json": { schema: connectSokoBotIntegrationRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      connectSokoBotIntegrationResponseSchema,
      "Where to send the owner to authorise the account",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(connectIntegrationRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const result = await connectSokoBotIntegration({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        provider: c.req.valid("param").provider,
        returnUrl: c.req.valid("json").returnUrl,
      });
      return ok(c, connectSokoBotIntegrationResponseSchema.parse(result));
    } catch (error) {
      mapIntegrationError(error);
    }
  });
}
