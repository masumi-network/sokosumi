import { createRoute } from "@hono/zod-openapi";
import { organizationRepository } from "@sokosumi/database/repositories";

import { buildAdminOrganizationOverviewItem } from "@/helpers/admin-organization-overview.js";
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
  adminOrganizationOverviewListSchema,
  adminOrganizationOverviewQuerySchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/overview",
  operationId: "listAdminOrganizationOverview",
  description:
    "Paginated overview of all organizations with member counts, billing, subscription, and total credits (admin only).",
  tags: ["Admin"],
  request: {
    query: adminOrganizationOverviewQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      adminOrganizationOverviewListSchema,
      "Paginated list of organizations for the admin overview",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const now = new Date();

    const { organizations, total } =
      await organizationRepository.listOrganizationsForAdminOverview(
        { query: queryParams.query, cursor, take: take + 1, skip },
        prisma,
      );

    const hasMore = organizations.length === take + 1;
    const pageOrganizations = organizations.slice(0, take);

    const items = await prisma.$transaction(async (tx) =>
      Promise.all(
        pageOrganizations.map((organization) =>
          buildAdminOrganizationOverviewItem(organization, tx, now),
        ),
      ),
    );

    const paginationMeta = createPaginationMeta(
      pageOrganizations,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      adminOrganizationOverviewListSchema.parse(items),
      paginationMeta,
    );
  });
}
