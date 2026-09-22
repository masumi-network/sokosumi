import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapVendor } from "@/helpers/vendor";
import { normalizeVendorInviteEmail } from "@/helpers/vendor-invite";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { vendorMembershipSchema } from "@/schemas/vendor.schema";

const params = z.object({
  inviteId: z.string().openapi({
    param: { name: "inviteId", in: "path" },
    description: "Vendor member invitation ID",
    example: "01960001-0001-7001-8001-000000000009",
  }),
});

const route = createRoute({
  method: "post",
  path: "/invites/{inviteId}/accept",
  operationId: "acceptVendorMemberInvite",
  description:
    "Accept a pending vendor member invitation addressed to the authenticated user's account email. Creates the vendor membership.",
  tags: ["Vendors"],
  request: { params },
  responses: {
    201: jsonSuccessResponse(
      vendorMembershipSchema,
      "The vendor membership created by accepting the invitation",
      {
        data: {
          id: "01960001-0001-7001-8001-000000000002",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          name: "Serviceplan",
          slug: "serviceplan",
          logos: { light: null, dark: null },
          role: "developer",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { inviteId } = c.req.valid("param");
    const userAuth = requireUserAuthContext(c.var.authContext);

    const user = await prisma.user.findUnique({
      where: { id: userAuth.userId },
      select: { email: true },
    });
    if (!user) {
      throw notFound("Invitation not found");
    }
    const myEmail = normalizeVendorInviteEmail(user.email);

    const membership = await serializableTransaction(async (tx) => {
      const invite = await tx.vendorMemberInvite.findUnique({
        where: { id: inviteId },
        include: { vendor: true },
      });

      // Not mine, gone, or expired: 404 either way so a non-recipient cannot
      // probe whether an invitation exists.
      if (
        !invite ||
        invite.status !== "PENDING" ||
        invite.expiresAt <= new Date() ||
        invite.email !== myEmail
      ) {
        throw notFound("Invitation not found");
      }

      const existing = await tx.vendorMember.findUnique({
        where: {
          vendorId_userId: {
            vendorId: invite.vendorId,
            userId: userAuth.userId,
          },
        },
        select: { role: true },
      });

      const role = existing?.role ?? invite.role;
      if (!existing) {
        await tx.vendorMember.create({
          data: {
            vendorId: invite.vendorId,
            userId: userAuth.userId,
            role: invite.role,
          },
        });
      }

      await tx.vendorMemberInvite.update({
        where: { id: invite.id },
        data: {
          status: "ACCEPTED",
          acceptedByUserId: userAuth.userId,
          resolvedAt: new Date(),
        },
      });

      return { vendor: invite.vendor, role };
    }, "Vendor invitation changed concurrently; retry the request");

    return created(
      c,
      vendorMembershipSchema.parse({
        ...mapVendor(membership.vendor),
        role: membership.role,
      }),
    );
  });
}
