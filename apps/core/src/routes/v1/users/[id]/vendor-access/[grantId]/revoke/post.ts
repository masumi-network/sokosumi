import { createRoute, z } from "@hono/zod-openapi";
import { VendorGrantStatus } from "@sokosumi/database";

import { forbidden, notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapVendorGrant, vendorGrantInclude } from "@/helpers/vendor";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import { type UserRouteVariables } from "@/routes/v1/users/user-route-context";
import { vendorGrantSchema } from "@/schemas/vendor.schema";

import { requireSelfSessionVendorAccess } from "../../auth";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  grantId: z.string().openapi({
    param: { name: "grantId", in: "path" },
    description: "Vendor grant ID",
    example: "01960001-0001-7001-8001-000000000099",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{grantId}/revoke",
  description:
    "Revoke a granted vendor access grant for the authenticated session user (path must be `me`).",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(vendorGrantSchema, "Vendor access grant revoked", {
      data: {
        id: "01960001-0001-7001-8001-000000000099",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        scope: "VENDOR",
        status: "REVOKED",
        vendorId: "01960001-0001-7001-8001-000000000001",
        vendor: {
          id: "01960001-0001-7001-8001-000000000001",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          name: "Serviceplan",
          slug: "serviceplan",
          logos: {
            light: null,
            dark: null,
          },
        },
        userId: "user_123",
        workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        workspace: {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          name: "Personal",
          slug: null,
          userId: "user_123",
          userName: "Alex",
          organizationId: null,
          organizationName: null,
          organizationSlug: null,
        },
        resolvedAt: "2025-01-01T00:00:00.000Z",
        awaitingVendorApprovalTaskCount: 0,
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { grantId } = c.req.valid("param");
    const { session } = requireSelfSessionVendorAccess(
      c.var.authContext,
      c.var.userRouteContext,
    );

    const existingGrant = await prisma.vendorGrant.findUnique({
      where: { id: grantId },
    });

    if (!existingGrant) {
      throw notFound("Vendor grant not found");
    }

    if (existingGrant.userId !== session.userId) {
      throw forbidden("You can only manage your own vendor access grants");
    }

    if (existingGrant.status !== VendorGrantStatus.GRANTED) {
      throw unprocessableEntity(
        `Cannot revoke vendor access grant with status ${existingGrant.status}`,
      );
    }

    const grant = await prisma.vendorGrant.update({
      where: { id: grantId },
      data: {
        status: VendorGrantStatus.REVOKED,
        resolvedAt: new Date(),
      },
      include: vendorGrantInclude,
    });

    return ok(c, vendorGrantSchema.parse(mapVendorGrant(grant)));
  });
}
