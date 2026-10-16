import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  isPersonalSokoBotAuthContext,
  isSokoBotAuthContext,
  isUserAuthContext,
  requireUserAuthContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotStateSchema } from "@/schemas/soko-bot-scope.schema";
import {
  getSokoBotState,
  listSharedSokoBots,
} from "@/services/soko-bot-state.service";
import { sokoBotIdParams, sokoBotIdSelector } from "../bot-selector.js";
import { mapBot } from "../helpers.js";

const responses = {
  200: jsonSuccessResponse(sokoBotStateSchema, "Soko Bot state"),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
};

const getMeRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/me",
    operationId: "getMySokoBot",
    tags: ["Soko Bots"],
    responses: {
      200: jsonSuccessResponse(
        sokoBotStateSchema,
        "Current user's Soko Bot state, and the shared bots they can reach",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

const getByIdRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{sokoBotId}",
    operationId: "getSokoBot",
    tags: ["Soko Bots"],
    request: { params: sokoBotIdParams },
    responses,
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getMeRoute, async (c) => {
    const authContext = c.var.authContext;
    const auth = isPersonalSokoBotAuthContext(authContext)
      ? authContext
      : requireUserAuthContext(authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const bot = await getSokoBotState(auth.userId, workspace.workspaceId);
    if (
      isSokoBotAuthContext(authContext) &&
      bot?.id !== authContext.sokoBotId
    ) {
      throw notFound("Soko Bot not found");
    }
    // A Soko Bot's own key gets no list; a member always does.
    const sharedBots = isUserAuthContext(authContext)
      ? await listSharedSokoBots(auth.userId, workspace.workspaceId)
      : undefined;
    return ok(
      c,
      sokoBotStateSchema.parse({
        sokoBot: mapBot(bot),
        ...(sharedBots ? { sharedBots } : {}),
      }),
    );
  });
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(getByIdRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const bot = await getSokoBotState(
      auth.userId,
      workspace.workspaceId,
      sokoBotIdSelector(c.req.valid("param")),
    );
    if (!bot) throw notFound("Soko Bot not found");
    return ok(c, sokoBotStateSchema.parse({ sokoBot: mapBot(bot) }));
  });
}
