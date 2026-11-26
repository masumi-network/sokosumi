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
import {
  adminEvalBotsFilterSchema,
  adminSokoBotListSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { sokoBotPaginationQuerySchema } from "./helpers.js";

type FleetBot = Awaited<
  ReturnType<typeof sokoBotControlPlane.listForAdmin>
>["items"][number];

/** Project bots (Cuso) have no userId; the member who created them owns them. */
function listItem({ _count, user, createdByUser, ...bot }: FleetBot) {
  return {
    ...bot,
    owner: user ?? (bot.projectId ? createdByUser : null),
    turnCount: _count.turns,
    pendingDecisionCount: _count.pendingDecisions,
    scheduleCount: _count.schedules,
  };
}

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminSokoBots",
  tags: ["Admin"],
  request: {
    query: sokoBotPaginationQuerySchema.extend({
      query: z.string().trim().max(200).optional(),
      kind: z
        .enum(["all", "assistant", "cmo"])
        .default("all")
        .describe("Personal Soko Bots, Cuso (CMO.xyz) bots, or both."),
      evals: adminEvalBotsFilterSchema,
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
      kind: query.kind,
      evals: query.evals,
    });
    const items = fleet.items.map(listItem);
    return ok(
      c,
      adminSokoBotListSchema.parse({
        total: fleet.total,
        items,
        summary: {
          ...fleet.summary,
          attention: fleet.summary.attention.map(listItem),
        },
      }),
      createPaginationMeta(items, fleet.total, take, fleet.hasMore, cursor),
    );
  });
}
