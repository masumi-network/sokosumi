import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  livePendingVendorInviteWhere,
  mapVendorMemberInvite,
} from "@/helpers/vendor-invite";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { vendorMemberInviteSchema } from "@/schemas/vendor.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const vendorInviteListSchema = z
  .array(vendorMemberInviteSchema)
  .openapi("VendorMemberInviteList");

const route = createRoute({
  method: "get",
  path: "/{id}/invites",
  operationId: "listVendorMemberInvites",
  description:
    "List a vendor's live pending member invitations (vendor admin only).",
  tags: ["Vendors"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      vendorInviteListSchema,
      "Live pending vendor invitations",
      {
        data: [
          {
            id: "01960001-0001-7001-8001-000000000001",
            vendorId: "01960001-0001-7001-8001-000000000002",
            email: "dev@example.com",
            role: "developer",
            status: "PENDING",
            expiresAt: "2025-01-08T00:00:00.000Z",
            createdAt: "2025-01-01T00:00:00.000Z",
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
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    const invites = await prisma.vendorMemberInvite.findMany({
      where: livePendingVendorInviteWhere(id),
      orderBy: { createdAt: "desc" },
    });

    return ok(
      c,
      vendorInviteListSchema.parse(invites.map(mapVendorMemberInvite)),
    );
  });
}
