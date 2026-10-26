import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import {
  requireReachableSokoBot,
  sokoBotIdParams,
} from "../../../../bot-selector.js";
import { mapControlPlaneError, turnParams } from "../../../../helpers.js";

const spec = {
  method: "post" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      z.object({ cancellationRequested: z.literal(true) }),
      "Cancel requested",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden: on a shared Soko Bot, only the member who asked or an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found"),
  },
};

const cancelTurnRoute = createRoute({
  ...spec,
  path: "/me/turns/{turnId}/cancel",
  operationId: "cancelMySokoBotTurn",
  request: { params: turnParams },
});

const cancelTurnByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/turns/{turnId}/cancel",
  operationId: "cancelSokoBotTurn",
  request: { params: turnParams.extend(sokoBotIdParams.shape) },
});

async function handle(
  c: Context<EnvVariables>,
  turnId: string,
  sokoBotId?: string,
) {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    if (sokoBotId) {
      const bot = await requireReachableSokoBot(
        auth.userId,
        requireWorkspaceContext(c.var.workspaceContext).workspaceId,
        sokoBotId,
      );
      const turn = await prisma.sokoBotTurn.findFirst({
        where: { id: turnId, sokoBotId: bot.id },
        select: { id: true },
      });
      if (!turn) throw notFound("Soko Bot turn not found");
    }
    await sokoBotControlPlane.cancelTurn(auth.userId, turnId);
    return ok(c, { cancellationRequested: true as const });
  } catch (error) {
    mapControlPlaneError(error);
  }
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(cancelTurnRoute, (c) => handle(c, c.req.valid("param").turnId));
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(cancelTurnByIdRoute, (c) => {
    const { turnId, sokoBotId } = c.req.valid("param");
    return handle(c, turnId, sokoBotId);
  });
}
