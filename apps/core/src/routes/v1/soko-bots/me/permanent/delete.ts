import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { ME_SOKO_BOT, type SokoBotSelector } from "@/helpers/soko-bot-resolver";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotDeletionResultSchema } from "@/schemas/soko-bot.schema";
import { deleteSokoBotForUser } from "@/services/soko-bot-deletion.service";
import { sokoBotIdParams, sokoBotIdSelector } from "../../bot-selector.js";

const spec = {
  method: "delete" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotDeletionResultSchema,
      "Soko Bot deleted; the owner may create a new one immediately",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden: a shared Soko Bot needs an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
};

const deleteMeRoute = createRoute({
  ...spec,
  path: "/me/permanent",
  operationId: "deleteMySokoBotPermanently",
});

const deleteByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/permanent",
  operationId: "deleteSokoBotPermanently",
  request: { params: sokoBotIdParams },
});

async function handle(c: Context<EnvVariables>, selector: SokoBotSelector) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const result = await deleteSokoBotForUser(
    auth.userId,
    workspace.workspaceId,
    selector,
  );
  return ok(c, result);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(deleteMeRoute, (c) => handle(c, ME_SOKO_BOT));
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(deleteByIdRoute, (c) =>
    handle(c, sokoBotIdSelector(c.req.valid("param"))),
  );
}
