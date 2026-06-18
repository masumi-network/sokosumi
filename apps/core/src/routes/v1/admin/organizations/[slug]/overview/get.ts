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
  path: "/{slug}/overview",
  operationId: "getAdminOrganizationOverviewBySlug",
  description:
    "Full organization overview with members, billing, subscription, seats, and credits (admin only).",
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

    const detail = await prisma.$transaction(async (tx) =>
      buildAdminOrganizationOverviewDetail(slug, tx),
    );

    if (!detail) {
      throw notFound("Organization not found");
    }

    return ok(c, adminOrganizationOverviewDetailSchema.parse(detail));
  });
}
