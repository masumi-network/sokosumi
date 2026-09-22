import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import { normalizeVendorInviteEmail } from "@/helpers/vendor-invite";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const params = z.object({
  inviteId: z.string().openapi({
    param: { name: "inviteId", in: "path" },
    description: "Vendor member invitation ID",
    example: "01960001-0001-7001-8001-000000000009",
  }),
});

const route = createRoute({
  method: "post",
  path: "/invites/{inviteId}/decline",
  operationId: "declineVendorMemberInvite",
  description:
    "Decline a pending vendor member invitation addressed to the authenticated user's account email.",
  tags: ["Vendors"],
  request: { params },
  responses: {
    204: { description: "Invitation declined" },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
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

    const result = await prisma.vendorMemberInvite.updateMany({
      where: {
        id: inviteId,
        email: myEmail,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      data: { status: "DECLINED", resolvedAt: new Date() },
    });

    if (result.count === 0) {
      throw notFound("Invitation not found");
    }

    return empty(c);
  });
}
