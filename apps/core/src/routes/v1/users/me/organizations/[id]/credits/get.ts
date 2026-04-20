import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { creditsResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/me/organizations/{id}/credits",
  description: "Get organization-context credits for the current member by ID",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      creditsResponseSchema,
      "Retrieve shared non-subscription organization credits plus the member subscription wallet",
      {
        data: {
          credits: {
            subscription: {
              plan: "starter",
              status: "active",
              periodStart: "2025-01-01T00:00:00.000Z",
              periodEnd: "2025-02-01T00:00:00.000Z",
              cancelAtPeriodEnd: false,
              credits: {
                total: 100,
                remaining: 57.5,
                used: 42.5,
              },
            },
            buffer: 12.5,
            total: 70,
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
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
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const credits = await prisma.$transaction(async (tx) => {
      const { organization } = await resolveMemberOrganizationById({
        id,
        userId: authContext.userId,
        tx,
      });
      return await buildCreditsPayload({
        userId: authContext.userId,
        organizationId: organization.id,
        referenceId: organization.id,
        tx,
      });
    });

    return ok(c, creditsResponseSchema.parse({ credits }));
  });
}
