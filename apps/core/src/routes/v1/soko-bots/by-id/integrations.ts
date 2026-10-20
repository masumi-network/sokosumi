import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  connectSokoBotIntegrationRequestSchema,
  connectSokoBotIntegrationResponseSchema,
  sokoBotIntegrationsSchema,
} from "@/schemas/soko-bot.schema";
import {
  completeSokoBotIntegrationAuthRequestSchema,
  completeSokoBotIntegrationAuthResponseSchema,
} from "@/schemas/soko-bot-integration-auth.schema";
import { completeSokoBotIntegrationAuth } from "@/services/soko-bot-integration-auth.service";
import {
  connectSokoBotIntegration,
  disconnectSokoBotIntegration,
  finalizeSokoBotIntegration,
} from "@/services/soko-bot-integration-connection.service";
import { listSokoBotIntegrationsForBot } from "@/services/soko-bot-integration-list.service";
import {
  requireReachableSokoBot,
  sokoBotIdParams,
  sokoBotIdSelector,
} from "../bot-selector.js";
import { mapIntegrationError, providerParamSchema } from "../helpers.js";

/**
 * Integrations of a bot by id. Any member who reaches a shared bot may list,
 * connect and disconnect; replacing another member's account needs that
 * member or an OWNER or ADMIN.
 *
 * There is no bare finalize here: finalizing hands the account to whoever
 * finalizes, so a shared bot's connection is finalized only through
 * complete-auth, which binds it to the account Composio verified for that
 * session.
 */
const tags = ["Soko Bots"];
const providerParams = providerParamSchema.extend(sokoBotIdParams.shape);

const listRoute = createRoute({
  method: "get",
  path: "/{sokoBotId}/integrations",
  operationId: "listSokoBotIntegrations",
  tags,
  request: { params: sokoBotIdParams },
  responses: {
    200: jsonSuccessResponse(
      sokoBotIntegrationsSchema,
      "Every provider with the bot's connection state",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

const connectRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/integrations/{provider}/connect",
  operationId: "connectSokoBotIntegration",
  tags,
  request: {
    params: providerParams,
    body: {
      content: {
        "application/json": { schema: connectSokoBotIntegrationRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      connectSokoBotIntegrationResponseSchema,
      "Where to send the member to authorise the account",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden: replacing another member's account needs that member or an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

const completeAuthRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/integrations/complete-auth",
  operationId: "completeSokoBotIntegrationAuth",
  tags,
  request: {
    params: sokoBotIdParams,
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
      "Connection state after Composio verified the returning member",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

const disconnectRoute = createRoute({
  method: "delete",
  path: "/{sokoBotId}/integrations/{provider}",
  operationId: "disconnectSokoBotIntegration",
  tags,
  request: { params: providerParams },
  responses: {
    200: jsonSuccessResponse(
      z.object({ disconnected: z.literal(true) }),
      "Disconnected",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export function mountSokoBotIntegrationByIdRoutes(app: OpenAPIHonoWithAuth) {
  app.openapi(listRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const bot = await requireReachableSokoBot(
        auth.userId,
        workspace.workspaceId,
        c.req.valid("param").sokoBotId,
      );
      return ok(
        c,
        sokoBotIntegrationsSchema.parse(
          await listSokoBotIntegrationsForBot(bot.id),
        ),
      );
    } catch (error) {
      mapIntegrationError(error);
    }
  });

  app.openapi(connectRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const params = c.req.valid("param");
    try {
      const result = await connectSokoBotIntegration({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        provider: params.provider,
        returnUrl: c.req.valid("json").returnUrl,
        selector: sokoBotIdSelector(params),
      });
      return ok(c, connectSokoBotIntegrationResponseSchema.parse(result));
    } catch (error) {
      mapIntegrationError(error);
    }
  });

  app.openapi(completeAuthRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const selector = sokoBotIdSelector(c.req.valid("param"));
    try {
      const completed = await completeSokoBotIntegrationAuth({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        sessionUri: c.req.valid("json").sessionUri,
        selector,
      });
      const status = await finalizeSokoBotIntegration({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        provider: completed.provider,
        expectedComposioAccountId: completed.composioAccountId,
        selector,
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

  app.openapi(disconnectRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const params = c.req.valid("param");
    try {
      await disconnectSokoBotIntegration({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        provider: params.provider,
        selector: sokoBotIdSelector(params),
      });
      return ok(c, { disconnected: true as const });
    } catch (error) {
      mapIntegrationError(error);
    }
  });
}
