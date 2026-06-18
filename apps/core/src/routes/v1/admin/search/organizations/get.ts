import { createRoute } from "@hono/zod-openapi";
import { organizationRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminOrganizationSearchResponseSchema,
  adminSearchQuerySchema,
} from "@/schemas/admin.schema";

const SEARCH_LIMIT = 20;

const route = createRoute({
  method: "get",
  path: "/organizations",
  operationId: "searchAdminOrganizations",
  description: "Search organizations by name or slug (admin only).",
  tags: ["Admin"],
  request: {
    query: adminSearchQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminOrganizationSearchResponseSchema,
      "Organizations matching the search query",
      {
        data: [{ id: "org_123", name: "Acme Corp", slug: "acme-corp" }],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { query } = c.req.valid("query");

    const organizations = await organizationRepository.searchOrganizations(
      query ?? "",
      SEARCH_LIMIT,
      prisma,
    );

    const options = organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    }));

    return ok(c, adminOrganizationSearchResponseSchema.parse(options));
  });
}
