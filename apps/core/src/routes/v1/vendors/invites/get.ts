import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapVendor } from "@/helpers/vendor";
import { normalizeVendorInviteEmail } from "@/helpers/vendor-invite";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { myVendorInviteSchema } from "@/schemas/vendor.schema";

const myVendorInviteListSchema = z
  .array(myVendorInviteSchema)
  .openapi("MyVendorInviteList");

const route = createRoute({
  method: "get",
  path: "/invites",
  operationId: "listMyVendorInvites",
  description:
    "List the authenticated user's live pending vendor member invitations (matched by account email).",
  tags: ["Vendors"],
  responses: {
    200: jsonSuccessResponse(
      myVendorInviteListSchema,
      "Pending vendor invitations for the current user",
      {
        data: [
          {
            id: "01960001-0001-7001-8001-000000000001",
            role: "developer",
            status: "PENDING",
            expiresAt: "2025-01-08T00:00:00.000Z",
            createdAt: "2025-01-01T00:00:00.000Z",
            vendor: {
              id: "01960001-0001-7001-8001-000000000002",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
              name: "Serviceplan",
              slug: "serviceplan",
              logos: { light: null, dark: null },
            },
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
    const userAuth = requireUserAuthContext(c.var.authContext);

    const user = await prisma.user.findUnique({
      where: { id: userAuth.userId },
      select: { email: true },
    });
    if (!user) {
      throw notFound("User not found");
    }

    const email = normalizeVendorInviteEmail(user.email);
    const now = new Date();
    const invites = await prisma.vendorMemberInvite.findMany({
      where: {
        email,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      include: { vendor: true },
      orderBy: { createdAt: "desc" },
    });

    return ok(
      c,
      myVendorInviteListSchema.parse(
        invites.map((invite) => ({
          id: invite.id,
          role: invite.role,
          status: invite.status,
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
          vendor: mapVendor(invite.vendor),
        })),
      ),
    );
  });
}
