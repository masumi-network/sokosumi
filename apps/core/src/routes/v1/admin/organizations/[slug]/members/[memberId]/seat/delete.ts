import { createRoute } from "@hono/zod-openapi";

import { getAdminOrganizationBySlug } from "@/helpers/admin-organization-overview.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminOrganizationMemberIdParamSchema } from "@/schemas/admin.schema";
import { organizationSeatUnassignmentSchema } from "@/schemas/organization-seat.schema";
import {
  mapSeatRepositoryError,
  unassignOrganizationMemberSeat,
} from "@/services/organization-seat.service";

const route = createRoute({
  method: "delete",
  path: "/{slug}/members/{memberId}/seat",
  operationId: "unassignAdminOrganizationMemberSeat",
  description: "Unassign a seat from an organization member (admin only).",
  tags: ["Admin"],
  request: {
    params: adminOrganizationMemberIdParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationSeatUnassignmentSchema,
      "The unassigned seat",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug, memberId } = c.req.valid("param");

    const organization = await getAdminOrganizationBySlug(slug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    try {
      const result = await prisma.$transaction(async (tx) =>
        unassignOrganizationMemberSeat(organization.id, memberId, tx),
      );

      return ok(c, organizationSeatUnassignmentSchema.parse(result));
    } catch (error) {
      mapSeatRepositoryError(error);
    }
  });
}
