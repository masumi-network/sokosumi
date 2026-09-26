import { createRoute, z } from "@hono/zod-openapi";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotTurnSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapTurn, sokoBotPaginationQuerySchema } from "../../helpers.js";

const listTurnsRoute = createRoute({
  method: "get",
  path: "/me/turns",
  operationId: "listMySokoBotTurns",
  tags: ["Soko Bots"],
  request: {
    query: sokoBotPaginationQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(sokoBotTurnSchema),
      "List Soko Bot turns",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listTurnsRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const query = c.req.valid("query");
    const { cursor, take } = parseCursorPagination(query);
    const { turns, count, hasMore } = await sokoBotControlPlane.listTurns(
      auth.userId,
      workspace.workspaceId,
      { cursor, take },
    );
    return ok(
      c,
      z.array(sokoBotTurnSchema).parse(turns.map(mapTurn)),
      createPaginationMeta(turns, count, take, hasMore, cursor),
    );
  });
}
