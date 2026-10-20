import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotTurnSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import {
  requireReachableSokoBot,
  sokoBotIdParams,
} from "../../../bot-selector.js";
import { mapControlPlaneError, mapTurn, turnParams } from "../../../helpers.js";

const spec = {
  method: "get" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotTurnSchema, "Get Soko Bot turn"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
};

const getTurnRoute = createRoute({
  ...spec,
  path: "/me/turns/{turnId}",
  operationId: "getMySokoBotTurn",
  request: { params: turnParams },
});

const getTurnByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/turns/{turnId}",
  operationId: "getSokoBotTurn",
  description:
    "Any turn of a bot the caller reaches. Every member reads a shared bot's turns.",
  request: { params: turnParams.extend(sokoBotIdParams.shape) },
});

async function handle(
  c: Context<EnvVariables>,
  turnId: string,
  sokoBotId?: string,
) {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    const bot = sokoBotId
      ? await requireReachableSokoBot(
          auth.userId,
          requireWorkspaceContext(c.var.workspaceContext).workspaceId,
          sokoBotId,
        )
      : null;
    const turn = await sokoBotControlPlane.getTurn(
      auth.userId,
      turnId,
      bot?.id,
    );
    return ok(c, sokoBotTurnSchema.parse(mapTurn(turn)));
  } catch (error) {
    mapControlPlaneError(error);
  }
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getTurnRoute, (c) => handle(c, c.req.valid("param").turnId));
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(getTurnByIdRoute, (c) => {
    const { turnId, sokoBotId } = c.req.valid("param");
    return handle(c, turnId, sokoBotId);
  });
}
