import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { ME_SOKO_BOT, type SokoBotSelector } from "@/helpers/soko-bot-resolver";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import {
  requireReachableSokoBot,
  sokoBotIdParams,
  sokoBotIdSelector,
} from "../bot-selector.js";

const spec = {
  method: "delete" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      z.object({ archived: z.literal(true) }),
      "Archive Soko Bot",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden: a shared Soko Bot needs an organization owner or admin",
    ),
  },
};

const archiveMeRoute = createRoute({
  ...spec,
  path: "/me",
  operationId: "archiveMySokoBot",
});

const archiveByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}",
  operationId: "archiveSokoBot",
  request: { params: sokoBotIdParams },
  responses: { ...spec.responses, 404: jsonErrorResponse("Not Found") },
});

async function handle(c: Context<EnvVariables>, selector: SokoBotSelector) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  await sokoBotControlPlane.archive(
    auth.userId,
    workspace.workspaceId,
    selector,
  );
  return ok(c, { archived: true as const });
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(archiveMeRoute, (c) => handle(c, ME_SOKO_BOT));
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(archiveByIdRoute, async (c) => {
    // `me` answers 200 when there is nothing to archive; an id names one
    // bot, so a bot the caller cannot reach is a 404.
    await requireReachableSokoBot(
      requireUserAuthContext(c.var.authContext).userId,
      requireWorkspaceContext(c.var.workspaceContext).workspaceId,
      c.req.valid("param").sokoBotId,
    );
    return handle(c, sokoBotIdSelector(c.req.valid("param")));
  });
}
