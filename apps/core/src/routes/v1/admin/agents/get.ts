import { createRoute } from "@hono/zod-openapi";

import {
  adminAgentListInclude,
  buildAdminAgentListOrderBy,
  buildAdminAgentListWhere,
  findAdminAgentIdsOrderedByDisplayName,
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
    const listWhere = buildAdminAgentListWhere({
      q: queryParams.q,
      status: queryParams.status,
    });

    if (queryParams.sortBy === "displayName") {
      const [orderedIds, total] = await Promise.all([
        findAdminAgentIdsOrderedByDisplayName(prisma, {
          sortOrder: queryParams.sortOrder,
          take: take + 1,
          cursor,
          q: queryParams.q,
          status: queryParams.status,
        }),
        prisma.agent.count({ where: listWhere }),
      ]);

      const agents =
        orderedIds.length === 0
          ? []
          : await prisma.agent.findMany({
              where: { id: { in: orderedIds } },
              include: adminAgentListInclude,
            });
      const byId = new Map(agents.map((agent) => [agent.id, agent]));
      const orderedAgents = orderedIds.flatMap((id) => {
        const agent = byId.get(id);
        return agent ? [agent] : [];
      });

      const hasMore = orderedIds.length === take + 1;
      const pageAgents = orderedAgents.slice(0, take);
      const items = pageAgents.map(mapAdminAgentListItem);
      const paginationMeta = createPaginationMeta(
        pageAgents,
        total,
        take,
        hasMore,
        cursor,
      );

      return ok(c, adminAgentListSchema.parse(items), paginationMeta);
    }

    const orderBy = buildAdminAgentListOrderBy(
      queryParams.sortBy,
      queryParams.sortOrder,
    );

    const [agents, total] = await prisma.$transaction([
      prisma.agent.findMany({
        where: listWhere,
        include: adminAgentListInclude,
        take: take + 1,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy,
      }),
      prisma.agent.count({ where: listWhere }),
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
