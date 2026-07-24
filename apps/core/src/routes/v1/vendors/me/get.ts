import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapVendor } from "@/helpers/vendor";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { vendorMembershipSchema } from "@/schemas/vendor.schema";

const vendorMembershipListSchema = z
  .array(vendorMembershipSchema)
  .openapi("VendorMembershipList");

const route = createRoute({
  method: "get",
  path: "/me",
  operationId: "listMyVendorMemberships",
  description:
    "List vendors where the authenticated user is a member, including membership role.",
  tags: ["Vendors"],
  responses: {
    200: jsonSuccessResponse(
      vendorMembershipListSchema,
      "List of vendor memberships for the current user",
      {
        data: [
          {
            id: "01960001-0001-7001-8001-000000000001",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            name: "Serviceplan",
            slug: "serviceplan",
            logos: {
              light: "/images/logos/serviceplan-logo.png",
              dark: "/images/logos/serviceplan-logo-white.png",
            },
            role: "admin",
          },
        ],
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
    const userAuth = requireUserAuthContext(c.var.authContext);

    const memberships = await prisma.vendorMember.findMany({
      where: { userId: userAuth.userId },
      include: { vendor: true },
      orderBy: [{ vendor: { name: "asc" } }, { vendor: { slug: "asc" } }],
    });

    return ok(
      c,
      vendorMembershipListSchema.parse(
        memberships.map((membership) => ({
          ...mapVendor(membership.vendor),
          role: membership.role,
        })),
      ),
    );
  });
}
