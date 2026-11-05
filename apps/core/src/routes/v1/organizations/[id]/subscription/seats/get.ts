import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { resolveOrganizationSubscriptionSeats } from "@/helpers/organization-subscription-seats";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { organizationSubscriptionSeatsSchema } from "@/schemas/subscription.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/subscription/seats",
  description:
    "Get the purchased seat count on an organization's active subscription and any reduction waiting for the next renewal. Any member may read this.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationSubscriptionSeatsSchema,
      "The purchased seats and the pending reduction",
      {
        data: {
          seats: 3,
          scheduledReduction: {
            effectiveAt: "2025-02-01T00:00:00.000Z",
            seats: 2,
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request - No active subscription"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You are not a member of this organization",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
    });

    return ok(
      c,
      organizationSubscriptionSeatsSchema.parse(
        await resolveOrganizationSubscriptionSeats(organization.id),
      ),
    );
  });
}
