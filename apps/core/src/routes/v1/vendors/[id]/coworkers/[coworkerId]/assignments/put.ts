import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  requireAssignableVendorMembership,
  requireCoworkerBelongsToVendor,
  requireVendorAdminMembership,
  resolveUserIdFromIdentity,
} from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  assignCoworkerRequestSchema,
  coworkerAssignmentSchema,
} from "@/schemas/vendor.schema";

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
});

const route = createRoute({
  method: "put",
  path: "/{id}/coworkers/{coworkerId}/assignments",
  operationId: "assignCoworkerDeveloper",
  description:
    "Assign a vendor member (admin or developer) to a coworker by userId or email (vendor admin only). Idempotent when the assignment already exists.",
  tags: ["Vendors"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: assignCoworkerRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      coworkerAssignmentSchema,
      "Coworker assignment created or already present",
      {
        data: {
          coworkerId: "cow_123",
          userId: "user_123",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, coworkerId } = c.req.valid("param");
    const body = c.req.valid("json");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);
    await requireCoworkerBelongsToVendor(coworkerId, id);

    const targetUserId = await resolveUserIdFromIdentity({
      userId: body.userId,
      email: body.email,
    });
    await requireAssignableVendorMembership(targetUserId, id);

    const assignment = await prisma.coworkerAssignment.upsert({
      where: {
        coworkerId_userId: {
          coworkerId,
          userId: targetUserId,
        },
      },
      create: {
        coworkerId,
        userId: targetUserId,
      },
      update: {},
    });

    return created(
      c,
      coworkerAssignmentSchema.parse({
        coworkerId: assignment.coworkerId,
        userId: assignment.userId,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
      }),
    );
  });
}
