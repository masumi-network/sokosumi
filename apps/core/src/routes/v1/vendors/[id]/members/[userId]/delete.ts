import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import {
  assertCanRemoveOrDemoteVendorAdmin,
  requireVendorAdminMembership,
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
    description: "Member user ID",
    example: "user_123",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/members/{userId}",
  operationId: "removeVendorMember",
  description:
    "Remove a vendor member by user ID (vendor admin only). Also removes that user's coworker assignments for this vendor. Cannot remove the last admin.",
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
    const { id, userId } = c.req.valid("param");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    // Serializable so the last-admin check and the delete commit as one unit
    // (SOK-1024).
    await serializableTransaction(async (tx) => {
      await assertCanRemoveOrDemoteVendorAdmin(id, userId, tx);
      await tx.coworkerAssignment.deleteMany({
        where: {
          userId,
          coworker: { vendorId: id },
        },
      });
      await tx.vendorMember.delete({
        where: {
          vendorId_userId: {
            vendorId: id,
            userId,
          },
        },
      });
    }, "Vendor membership changed concurrently; retry the request");

    return c.body(null, 204);
  });
}
