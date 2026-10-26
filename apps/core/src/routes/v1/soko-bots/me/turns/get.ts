import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { ME_SOKO_BOT, type SokoBotSelector } from "@/helpers/soko-bot-resolver";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotTurnSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import {
  requireReachableSokoBot,
  sokoBotIdParams,
  sokoBotIdSelector,
} from "../../bot-selector.js";
import { mapTurn, sokoBotPaginationQuerySchema } from "../../helpers.js";

const spec = {
  method: "get" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(sokoBotTurnSchema),
      "List Soko Bot turns",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
};

const listTurnsRoute = createRoute({
  ...spec,
  path: "/me/turns",
  operationId: "listMySokoBotTurns",
  request: { query: sokoBotPaginationQuerySchema },
});

const listTurnsByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/turns",
  operationId: "listSokoBotTurns",
  request: { query: sokoBotPaginationQuerySchema, params: sokoBotIdParams },
  responses: { ...spec.responses, 404: jsonErrorResponse("Not Found") },
});

async function handle(
  c: Context<EnvVariables>,
  selector: SokoBotSelector,
  query: { cursor?: string; limit?: number },
) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const { cursor, take } = parseCursorPagination(query);
  const { turns, count, hasMore } = await sokoBotControlPlane.listTurns(
    auth.userId,
    workspace.workspaceId,
    { cursor, take },
    selector,
  );
  return ok(
    c,
    z.array(sokoBotTurnSchema).parse(turns.map(mapTurn)),
    createPaginationMeta(turns, count, take, hasMore, cursor),
  );
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listTurnsRoute, (c) =>
    handle(c, ME_SOKO_BOT, c.req.valid("query")),
  );
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(listTurnsByIdRoute, async (c) => {
    const param = c.req.valid("param");
    await requireReachableSokoBot(
      requireUserAuthContext(c.var.authContext).userId,
      requireWorkspaceContext(c.var.workspaceContext).workspaceId,
      param.sokoBotId,
    );
    return handle(c, sokoBotIdSelector(param), c.req.valid("query"));
  });
}
