import { createRoute, z } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapVendorMember } from "@/helpers/vendor";
import {
  requireVendorAdminMembership,
  resolveUserIdFromIdentity,
} from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  addVendorMemberRequestSchema,
  vendorMemberSchema,
} from "@/schemas/vendor.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/members",
  operationId: "addVendorMember",
  description:
    "Add an existing user as a vendor member by userId or email (vendor admin only). Role is optional and defaults to developer.",
  tags: ["Vendors"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: addVendorMemberRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(vendorMemberSchema, "Vendor member created", {
      data: {
        id: "user_123",
        email: "dev@example.com",
        name: "Dev User",
        role: "developer",
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
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    const targetUserId = await resolveUserIdFromIdentity({
      userId: body.userId,
      email: body.email,
    });

    const existing = await prisma.vendorMember.findUnique({
      where: {
        vendorId_userId: {
          vendorId: id,
          userId: targetUserId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw conflict("User is already a member of this vendor");
    }

    const member = await prisma.vendorMember.create({
      data: {
        vendorId: id,
        userId: targetUserId,
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

    return created(c, mapVendorMember(member));
  });
}
