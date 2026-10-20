import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  isPersonalSokoBotAuthContext,
  isSokoBotAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotUsageSchema } from "@/schemas/soko-bot.schema";
import { getSokoBotState } from "@/services/soko-bot-state.service";
import { sokoBotUsageTotals } from "@/services/soko-bot-usage.service";
import {
  requireReachableSokoBot,
  sokoBotIdParams,
} from "../../bot-selector.js";

const spec = {
  method: "get" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotUsageSchema, "Lifetime usage and cost"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
};

// Its own route rather than a field on `/me`: that one is polled for turn
// state and this aggregates every turn the bot has ever taken.
const getMyUsageRoute = createRoute({
  ...spec,
  path: "/me/usage",
  operationId: "getMySokoBotUsage",
});

const getUsageByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/usage",
  operationId: "getSokoBotUsage",
  request: { params: sokoBotIdParams },
});

async function usage(c: Context<EnvVariables>, sokoBotId: string) {
  return ok(c, sokoBotUsageSchema.parse(await sokoBotUsageTotals(sokoBotId)));
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getMyUsageRoute, async (c) => {
    const authContext = c.var.authContext;
    const auth = isPersonalSokoBotAuthContext(authContext)
      ? authContext
      : requireUserAuthContext(authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const bot = await getSokoBotState(auth.userId, workspace.workspaceId);
    if (
      !bot ||
      (isSokoBotAuthContext(authContext) && bot.id !== authContext.sokoBotId)
    ) {
      throw notFound("Soko Bot not found");
    }
    return usage(c, bot.id);
  });
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(getUsageByIdRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const bot = await requireReachableSokoBot(
      auth.userId,
      requireWorkspaceContext(c.var.workspaceContext).workspaceId,
      c.req.valid("param").sokoBotId,
    );
    return usage(c, bot.id);
  });
}
