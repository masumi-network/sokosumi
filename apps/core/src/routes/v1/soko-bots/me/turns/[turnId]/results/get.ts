import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { chatResultPreviewSchema } from "@/schemas/chat-result-preview.schema";
import {
  collectTurnResultSnapshots,
  hydrateChatResultSnapshots,
} from "@/services/chat-result-preview.service";
import {
  requireReachableSokoBot,
  sokoBotIdParams,
} from "../../../../bot-selector.js";
import { turnParams } from "../../../../helpers";

const spec = {
  method: "get" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      z.array(chatResultPreviewSchema),
      "Authorized recorded turn results",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
};

const route = createRoute({
  ...spec,
  path: "/me/turns/{turnId}/results",
  operationId: "getMySokoBotTurnResults",
  request: { params: turnParams },
});

const byIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/turns/{turnId}/results",
  operationId: "getSokoBotTurnResults",
  request: { params: turnParams.extend(sokoBotIdParams.shape) },
});

/** Each result is still authorized for the viewer when it is hydrated. */
async function handle(
  c: Context<EnvVariables>,
  turnId: string,
  sokoBotId?: string,
) {
  c.header("Cache-Control", "private, no-store");
  const auth = requireUserAuthContext(c.var.authContext);
  const owner = sokoBotId
    ? {
        sokoBotId: (
          await requireReachableSokoBot(
            auth.userId,
            requireWorkspaceContext(c.var.workspaceContext).workspaceId,
            sokoBotId,
          )
        ).id,
      }
    : // The caller's own bot, never a shared bot they asked once.
      { requestedByUserId: auth.userId, sokoBot: { userId: auth.userId } };
  const turn = await prisma.sokoBotTurn.findFirst({
    where: { id: turnId, ...owner, status: "COMPLETED" },
    select: { id: true },
  });
  if (!turn) throw notFound("Result unavailable");
  return ok(
    c,
    await hydrateChatResultSnapshots(
      await collectTurnResultSnapshots(turn.id),
      auth.userId,
    ),
  );
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, (c) => handle(c, c.req.valid("param").turnId));
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(byIdRoute, (c) => {
    const { turnId, sokoBotId } = c.req.valid("param");
    return handle(c, turnId, sokoBotId);
  });
}
