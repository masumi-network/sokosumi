import { createRoute } from "@hono/zod-openapi";

import {
  adminAgentListInclude,
  buildAdminAgentSearchWhere,
  mapAdminAgentListItem,
} from "@/helpers/admin-agent";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminAgentListQuerySchema,
  adminAgentListSchema,
} from "@/schemas/admin-agent.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminAgents",
  description:
    "Paginated list of all agents with registry identity and override summary (admin only).",
  tags: ["Admin"],
  request: {
    query: adminAgentListQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      adminAgentListSchema,
      "Paginated list of agents for the admin console",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const searchWhere = buildAdminAgentSearchWhere(queryParams.q);

    const [agents, total] = await prisma.$transaction([
      prisma.agent.findMany({
        where: searchWhere,
        include: adminAgentListInclude,
        take: take + 1,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      prisma.agent.count({ where: searchWhere }),
    ]);

    const hasMore = agents.length === take + 1;
    const pageAgents = agents.slice(0, take);
    const items = pageAgents.map(mapAdminAgentListItem);
    const paginationMeta = createPaginationMeta(
      pageAgents,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(c, adminAgentListSchema.parse(items), paginationMeta);
  });
}
