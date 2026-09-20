import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import {
  assertCanRemoveOrDemoteVendorAdmin,
  requireVendorAdminMembership,
  resolveUserIdFromUserIdOrEmail,
} from "@/helpers/vendor-membership";
import { serializableTransaction } from "@/lib/db/transaction";
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
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, userId: userIdOrEmail } = c.req.valid("param");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    const targetUserId = await resolveUserIdFromUserIdOrEmail(userIdOrEmail);

    // Serializable so the last-admin check (which also 404s a missing member)
    // and the delete commit as one unit (SOK-1024): a concurrent demote/remove
    // cannot both pass the guard.
    await serializableTransaction(async (tx) => {
      await assertCanRemoveOrDemoteVendorAdmin(id, targetUserId, tx);
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
    }, "Vendor membership changed concurrently; retry the request");

    return c.body(null, 204);
  });
}
