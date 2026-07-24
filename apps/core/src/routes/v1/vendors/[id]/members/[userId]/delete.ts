import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  assertCanRemoveOrDemoteVendorAdmin,
  requireVendorAdminMembership,
  resolveUserIdFromUserIdOrEmail,
} from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
  userId: z.string().openapi({
    param: { name: "userId", in: "path" },
    description: "Member user ID or email address",
    example: "user_123",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/members/{userId}",
  operationId: "removeVendorMember",
  description:
    "Remove a vendor member (vendor admin only). Path accepts user ID or email. Also removes that user's coworker assignments for this vendor. Cannot remove the last admin.",
  tags: ["Vendors"],
  request: {
    params,
  },
  responses: {
    204: {
      description: "Member removed",
    },
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, userId: userIdOrEmail } = c.req.valid("param");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    const targetUserId = await resolveUserIdFromUserIdOrEmail(userIdOrEmail);

    await assertCanRemoveOrDemoteVendorAdmin(id, targetUserId);

    const existing = await prisma.vendorMember.findUnique({
      where: {
        vendorId_userId: {
          vendorId: id,
          userId: targetUserId,
        },
      },
      select: { id: true },
    });
    if (!existing) {
      throw notFound("Vendor member not found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.coworkerAssignment.deleteMany({
        where: {
          userId: targetUserId,
          coworker: { vendorId: id },
        },
      });
      await tx.vendorMember.delete({
        where: {
          vendorId_userId: {
            vendorId: id,
            userId: targetUserId,
          },
        },
      });
    });

    return c.body(null, 204);
  });
}
