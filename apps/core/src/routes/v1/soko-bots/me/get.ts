import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  isSokoBotAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotStateSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapBot } from "../helpers.js";

const getMeRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/me",
    operationId: "getMySokoBot",
    tags: ["Soko Bots"],
    responses: {
      200: jsonSuccessResponse(
        sokoBotStateSchema,
        "Current user's Soko Bot state",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getMeRoute, async (c) => {
    const authContext = c.var.authContext;
    const auth = isSokoBotAuthContext(authContext)
      ? authContext
      : requireUserAuthContext(authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const bot = await sokoBotControlPlane.getForUser(
      auth.userId,
      workspace.workspaceId,
    );
    if (
      isSokoBotAuthContext(authContext) &&
      bot?.id !== authContext.sokoBotId
    ) {
      throw notFound("Soko Bot not found");
    }
    return ok(c, sokoBotStateSchema.parse({ sokoBot: mapBot(bot) }));
  });
}
