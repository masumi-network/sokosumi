import { createRoute } from "@hono/zod-openapi";

import {
  getAdminOrganizationBySlug,
  listAdminExternalChannels,
} from "@/helpers/admin-organization-overview.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminExternalChannelOptionListSchema,
  adminOrganizationSlugParamSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/{slug}/external-channels",
  operationId: "listAdminOrgExternalChannels",
  description:
    "List live External channels owned by the organization (admin only).",
  tags: ["Admin"],
  request: {
    params: adminOrganizationSlugParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminExternalChannelOptionListSchema,
      "External channels for the host organization",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug } = c.req.valid("param");

    const organization = await getAdminOrganizationBySlug(slug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    const channels = await listAdminExternalChannels(organization.id, prisma);
    return ok(c, adminExternalChannelOptionListSchema.parse(channels));
  });
}
