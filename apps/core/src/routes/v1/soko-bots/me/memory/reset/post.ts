import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { ME_SOKO_BOT, type SokoBotSelector } from "@/helpers/soko-bot-resolver";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotMemorySchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { sokoBotIdParams, sokoBotIdSelector } from "../../../bot-selector.js";
import { mapControlPlaneError } from "../../../helpers.js";

const spec = {
  method: "post" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotMemorySchema, "Reset Soko Bot memory"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden: a shared Soko Bot needs an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
};

const resetMemoryRoute = createRoute({
  ...spec,
  path: "/me/memory/reset",
  operationId: "resetMySokoBotMemory",
});

const resetMemoryByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/memory/reset",
  operationId: "resetSokoBotMemory",
  request: { params: sokoBotIdParams },
});

async function handle(c: Context<EnvVariables>, selector: SokoBotSelector) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const memory = await sokoBotControlPlane.resetMemory(
      auth.userId,
      workspace.workspaceId,
      selector,
    );
    return ok(c, sokoBotMemorySchema.parse(memory));
  } catch (error) {
    mapControlPlaneError(error);
  }
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(resetMemoryRoute, (c) => handle(c, ME_SOKO_BOT));
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(resetMemoryByIdRoute, (c) =>
    handle(c, sokoBotIdSelector(c.req.valid("param"))),
  );
}
