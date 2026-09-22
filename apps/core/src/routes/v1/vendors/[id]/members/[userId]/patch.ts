import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapVendorMember } from "@/helpers/vendor";
import {
  assertCanRemoveOrDemoteVendorAdmin,
  requireVendorAdminMembership,
} from "@/helpers/vendor-membership";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  patchVendorMemberRoleRequestSchema,
  vendorMemberSchema,
} from "@/schemas/vendor.schema";

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
  method: "patch",
  path: "/{id}/members/{userId}",
  operationId: "patchVendorMemberRole",
  description:
    "Change a vendor member role between admin and developer by user ID (vendor admin only). Cannot demote the last admin.",
  tags: ["Vendors"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: patchVendorMemberRoleRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(vendorMemberSchema, "Updated vendor member", {
      data: {
        id: "user_123",
        email: "dev@example.com",
        name: "Dev User",
        role: "admin",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
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
    const body = c.req.valid("json");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    // Serializable so the role read, the last-admin check, and the update
    // commit as one unit (SOK-1024).
    const member = await serializableTransaction(async (tx) => {
      const existing = await tx.vendorMember.findUnique({
        where: {
          vendorId_userId: {
            vendorId: id,
            userId,
          },
        },
        select: { role: true },
      });
      if (!existing) {
        throw notFound("Vendor member not found");
      }

      if (existing.role === "admin" && body.role !== "admin") {
        await assertCanRemoveOrDemoteVendorAdmin(id, userId, tx);
      }

      return tx.vendorMember.update({
        where: {
          vendorId_userId: {
            vendorId: id,
            userId,
          },
        },
        data: {
          role: body.role,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      });
    }, "Vendor membership changed concurrently; retry the request");

    return ok(c, mapVendorMember(member));
  });
}
