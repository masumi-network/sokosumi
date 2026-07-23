import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import {
  requireCoworkerBelongsToVendor,
  requireVendorAdminMembership,
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
  coworkerId: z.string().openapi({
    param: { name: "coworkerId", in: "path" },
    description: "Coworker ID",
    example: "cow_123",
  }),
  userId: z.string().openapi({
    param: { name: "userId", in: "path" },
    description: "Assigned user ID",
    example: "user_123",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/coworkers/{coworkerId}/assignments/{userId}",
  operationId: "unassignCoworkerDeveloper",
  description:
    "Remove a developer assignment from a vendor coworker (vendor admin only). Idempotent when the assignment is already absent.",
  tags: ["Vendors"],
  request: {
    params,
  },
  responses: {
    204: {
      description: "Assignment removed or already absent",
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, coworkerId, userId } = c.req.valid("param");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);
    await requireCoworkerBelongsToVendor(coworkerId, id);

    await prisma.coworkerAssignment.deleteMany({
      where: {
        coworkerId,
        userId,
      },
    });

    return c.body(null, 204);
  });
}
