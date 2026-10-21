import { createRoute, type z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { ME_SOKO_BOT, type SokoBotSelector } from "@/helpers/soko-bot-resolver";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole, requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  sokoBotSchema,
  updateSokoBotVersionRequestSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { getSokoBotState } from "@/services/soko-bot-state.service";
import { sokoBotIdParams, sokoBotIdSelector } from "../../bot-selector.js";
import { mapBot, mapControlPlaneError } from "../../helpers.js";

const body = {
  content: {
    "application/json": { schema: updateSokoBotVersionRequestSchema },
  },
};

const spec = {
  method: "put" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Bot with the new version"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
};

const updateVersionRoute = createRoute({
  ...spec,
  path: "/me/version",
  operationId: "updateMySokoBotVersion",
  request: { body },
});

const updateVersionByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/version",
  operationId: "updateSokoBotVersion",
  request: { body, params: sokoBotIdParams },
});

/** A setting: any member with access may pin a shared bot's version. */
async function handle(
  c: Context<EnvVariables>,
  selector: SokoBotSelector,
  input: z.infer<typeof updateSokoBotVersionRequestSchema>,
) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    await sokoBotControlPlane.updateVersion(
      auth.userId,
      workspace.workspaceId,
      input.versionId,
      { allowUnpromoted: hasAdminRole(auth.role) },
      selector,
    );
  } catch (error) {
    mapControlPlaneError(error);
  }
  const refreshed = await getSokoBotState(
    auth.userId,
    workspace.workspaceId,
    selector,
  );
  return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(updateVersionRoute, (c) =>
    handle(c, ME_SOKO_BOT, c.req.valid("json")),
  );
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(updateVersionByIdRoute, (c) =>
    handle(c, sokoBotIdSelector(c.req.valid("param")), c.req.valid("json")),
  );
}
