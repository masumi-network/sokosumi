import { createRoute } from "@hono/zod-openapi";

import { mapAdminAgentListItem } from "@/helpers/admin-agent";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { listAgents } from "@/lib/agent-catalog/admin";
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
    const { cursor, take } = parseCursorPagination(queryParams);
    const { agents, total, hasMore } = await listAgents(c.var.networkScope, {
      ...(queryParams.q !== undefined && { q: queryParams.q }),
      ...(queryParams.status !== undefined && { status: queryParams.status }),
      sortBy: queryParams.sortBy,
      sortOrder: queryParams.sortOrder,
      ...(cursor !== undefined && { cursor }),
      take,
    });
    const items = agents.map(mapAdminAgentListItem);
    const paginationMeta = createPaginationMeta(
      agents,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(c, adminAgentListSchema.parse(items), paginationMeta);
  });
}
