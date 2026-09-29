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
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminSokoBotListSchema } from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { sokoBotPaginationQuerySchema } from "./helpers.js";

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminSokoBots",
  tags: ["Admin"],
  request: {
    query: sokoBotPaginationQuerySchema.extend({
      query: z.string().trim().max(200).optional(),
    }),
  },
  responses: {
    200: jsonPaginatedSuccessResponse(adminSokoBotListSchema, "Soko Bot fleet"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listRoute, async (c) => {
    const query = c.req.valid("query");
    const { cursor, take } = parseCursorPagination(query);
    const fleet = await sokoBotControlPlane.listForAdmin(query.query, {
      cursor,
      take,
    });
    const items = fleet.items.map(({ _count, user, ...bot }) => ({
      ...bot,
      owner: user,
      turnCount: _count.turns,
      pendingDecisionCount: _count.pendingDecisions,
      scheduleCount: _count.schedules,
    }));
    return ok(
      c,
      adminSokoBotListSchema.parse({
        total: fleet.total,
        items,
      }),
      createPaginationMeta(items, fleet.total, take, fleet.hasMore, cursor),
    );
  });
}
