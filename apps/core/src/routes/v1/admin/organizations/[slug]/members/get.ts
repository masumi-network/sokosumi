import { createRoute } from "@hono/zod-openapi";

import {
  buildAdminOrganizationMemberOverviewPage,
  getAdminOrganizationBySlug,
} from "@/helpers/admin-organization-overview.js";
import { notFound } from "@/helpers/error";
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
  adminOrganizationMemberOverviewListSchema,
  adminOrganizationMemberOverviewQuerySchema,
  adminOrganizationSlugParamSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/{slug}/members",
  operationId: "listAdminOrganizationMembers",
  description:
    "Paginated organization members with credits and subscription details (admin only).",
  tags: ["Admin"],
  request: {
    params: adminOrganizationSlugParamSchema,
    query: adminOrganizationMemberOverviewQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      adminOrganizationMemberOverviewListSchema,
      "Paginated list of organization members for the admin overview",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug } = c.req.valid("param");
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    const organization = await getAdminOrganizationBySlug(slug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    const page = await buildAdminOrganizationMemberOverviewPage(
      slug,
      { cursor, take: take + 1, skip },
      prisma,
    );

    if (!page) {
      throw notFound("Organization not found");
    }

    const hasMore = page.members.length === take + 1;
    const pageMembers = page.members.slice(0, take);

    const paginationMeta = createPaginationMeta(
      pageMembers,
      page.total,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      adminOrganizationMemberOverviewListSchema.parse(pageMembers),
      paginationMeta,
    );
  });
}
