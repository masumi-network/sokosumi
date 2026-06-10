import { createRoute } from "@hono/zod-openapi";
import { organizationRepository } from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminOrganizationOptionSchema,
  adminOrganizationSlugParamSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/{slug}",
  operationId: "getAdminOrganizationBySlug",
  description:
    "Fetch a single organization's limited info by slug (admin only). Returns 404 when no organization matches.",
  tags: ["Admin"],
  request: {
    params: adminOrganizationSlugParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminOrganizationOptionSchema,
      "Organization matching the slug",
      {
        data: { id: "org_123", name: "Acme Corp", slug: "acme-corp" },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug } = c.req.valid("param");

    const organization =
      await organizationRepository.getOrganizationLimitedInfoBySlug(
        slug,
        prisma,
      );

    if (!organization) {
      throw notFound("Organization not found");
    }

    return ok(
      c,
      adminOrganizationOptionSchema.parse({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      }),
    );
  });
}
