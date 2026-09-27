import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  isSokoBotAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotUsageSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { sokoBotUsageTotals } from "@/services/soko-bot-usage.service";

const getMyUsageRoute = createRoute({
  method: "get",
  path: "/me/usage",
  operationId: "getMySokoBotUsage",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotUsageSchema, "Lifetime usage and cost"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

// Its own route rather than a field on `/me`: that one is polled for turn
// state and this aggregates every turn the bot has ever taken.

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getMyUsageRoute, async (c) => {
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
      !bot ||
      (isSokoBotAuthContext(authContext) && bot.id !== authContext.sokoBotId)
    ) {
      throw notFound("Soko Bot not found");
    }
    return ok(c, sokoBotUsageSchema.parse(await sokoBotUsageTotals(bot.id)));
  });
}
