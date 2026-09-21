import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  completeSokoBotIntegrationAuthRequestSchema,
  completeSokoBotIntegrationAuthResponseSchema,
} from "@/schemas/soko-bot-integration-auth.schema";
import { completeSokoBotIntegrationAuth } from "@/services/soko-bot-integration-auth.service";
import { finalizeSokoBotIntegration } from "@/services/soko-bot-integrations.service";
import { mapIntegrationError } from "./integration-error.js";

export function mountSokoBotIntegrationAuthRoutes(
  app: OpenAPIHonoWithAuth,
): void {
  const completeAuthRoute = createRoute({
    method: "post",
    path: "/me/integrations/complete-auth",
    operationId: "completeMySokoBotIntegrationAuth",
    tags: ["Soko Bots"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: completeSokoBotIntegrationAuthRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        completeSokoBotIntegrationAuthResponseSchema,
        "Connection state after Composio verified the returning user",
      ),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  });

  app.openapi(completeAuthRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      // Composio only releases the connection once it agrees the caller is the
      // entity the authorization was started for.
      const completed = await completeSokoBotIntegrationAuth({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        sessionUri: c.req.valid("json").sessionUri,
      });
      const status = await finalizeSokoBotIntegration({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        provider: completed.provider,
        expectedComposioAccountId: completed.composioAccountId,
      });
      return ok(
        c,
        completeSokoBotIntegrationAuthResponseSchema.parse({
          provider: completed.provider,
          status,
        }),
      );
    } catch (error) {
      mapIntegrationError(error);
    }
  });
}
