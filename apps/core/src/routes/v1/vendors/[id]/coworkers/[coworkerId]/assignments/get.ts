import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  requireCoworkerBelongsToVendor,
  requireVendorAdminMembership,
} from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { coworkerAssignmentSchema } from "@/schemas/vendor.schema";

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

const assignmentListSchema = z
  .array(coworkerAssignmentSchema)
  .openapi("CoworkerAssignmentList");

const route = createRoute({
  method: "get",
  path: "/{id}/coworkers/{coworkerId}/assignments",
  operationId: "listCoworkerAssignments",
  description:
    "List developer assignments for a vendor coworker (vendor admin only).",
  tags: ["Vendors"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      assignmentListSchema,
      "List of coworker assignments",
      {
        data: [
          {
            coworkerId: "cow_123",
            userId: "user_123",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
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
    const { id, coworkerId } = c.req.valid("param");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);
    await requireCoworkerBelongsToVendor(coworkerId, id);

    const assignments = await prisma.coworkerAssignment.findMany({
      where: { coworkerId },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    });

    return ok(
      c,
      assignmentListSchema.parse(
        assignments.map((assignment) => ({
          coworkerId: assignment.coworkerId,
          userId: assignment.userId,
          createdAt: assignment.createdAt,
          updatedAt: assignment.updatedAt,
        })),
      ),
    );
  });
}
