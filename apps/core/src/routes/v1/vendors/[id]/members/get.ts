import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { vendorMemberSchema } from "@/schemas/vendor.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const vendorMemberListSchema = z
  .array(vendorMemberSchema)
  .openapi("VendorMemberList");

const route = createRoute({
  method: "get",
  path: "/{id}/members",
  operationId: "listVendorMembers",
  description:
    "List vendor members with user identity fields (vendor admin only).",
  tags: ["Vendors"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(vendorMemberListSchema, "List of vendor members", {
      data: [
        {
          id: "user_123",
          email: "dev@example.com",
          name: "Dev User",
          role: "developer",
        },
      ],
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const userAuth = requireUserAuthContext(c.var.authContext);

    await requireVendorAdminMembership(userAuth.userId, id);

    const members = await prisma.vendorMember.findMany({
      where: { vendorId: id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: [{ user: { name: "asc" } }, { user: { email: "asc" } }],
    });

    return ok(
      c,
      vendorMemberListSchema.parse(
        members.map((member) => ({
          id: member.user.id,
          email: member.user.email,
          name: member.user.name,
          role: member.role,
        })),
      ),
    );
  });
}
