import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { ME_SOKO_BOT, type SokoBotSelector } from "@/helpers/soko-bot-resolver";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotActivitySchema } from "@/schemas/soko-bot.schema";
import { getSokoBotActivity } from "@/services/soko-bot-state.service";
import { sokoBotIdParams, sokoBotIdSelector } from "../../bot-selector.js";

// Polled every couple of seconds by the console, which watches turns started
// elsewhere. One indexed read, so it can be asked often enough to catch a turn
// that only runs for a few seconds.
const spec = {
  method: "get" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotActivitySchema,
      "Whether the assistant is working right now",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
};

const getMyActivityRoute = createRoute({
  ...spec,
  path: "/me/activity",
  operationId: "getMySokoBotActivity",
});

const getActivityByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/activity",
  operationId: "getSokoBotActivity",
  request: { params: sokoBotIdParams },
});

async function handle(c: Context<EnvVariables>, selector: SokoBotSelector) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const activity = await getSokoBotActivity(
    auth.userId,
    workspace.workspaceId,
    selector,
  );
  if (!activity) throw notFound("Soko Bot not found");
  return ok(c, sokoBotActivitySchema.parse(activity));
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getMyActivityRoute, (c) => handle(c, ME_SOKO_BOT));
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(getActivityByIdRoute, (c) =>
    handle(c, sokoBotIdSelector(c.req.valid("param"))),
  );
}
