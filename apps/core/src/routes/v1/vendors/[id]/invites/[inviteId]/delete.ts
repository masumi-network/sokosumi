import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
  inviteId: z.string().openapi({
    param: { name: "inviteId", in: "path" },
    description: "Vendor member invitation ID",
    example: "01960001-0001-7001-8001-000000000009",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/invites/{inviteId}",
  operationId: "revokeVendorMemberInvite",
  description:
    "Revoke a vendor's pending member invitation (vendor admin only).",
  tags: ["Vendors"],
  request: { params },
  responses: {
    204: { description: "Invitation revoked" },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, inviteId } = c.req.valid("param");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    const result = await prisma.vendorMemberInvite.updateMany({
      where: { id: inviteId, vendorId: id, status: "PENDING" },
      data: { status: "REVOKED", resolvedAt: new Date() },
    });

    if (result.count === 0) {
      throw notFound("Pending invitation not found");
    }

    return empty(c);
  });
}
