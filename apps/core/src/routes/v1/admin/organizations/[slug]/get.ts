import { createRoute } from "@hono/zod-openapi";

import { buildAdminOrganizationOverviewDetail } from "@/helpers/admin-organization-overview.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminOrganizationOverviewDetailSchema,
  adminOrganizationSlugParamSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/{slug}",
  operationId: "getAdminOrganizationBySlug",
  description:
    "Full organization overview with billing, subscription, seats, and credits (admin only).",
  tags: ["Admin"],
  request: {
    params: adminOrganizationSlugParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminOrganizationOverviewDetailSchema,
      "Organization overview for the admin console",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug } = c.req.valid("param");

    const detail = await buildAdminOrganizationOverviewDetail(slug, prisma);

    if (!detail) {
      throw notFound("Organization not found");
    }

    return ok(c, adminOrganizationOverviewDetailSchema.parse(detail));
  });
}
