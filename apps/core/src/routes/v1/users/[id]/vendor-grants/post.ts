import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  grantWorkspaceAccess,
  toVendorGrantApiShape,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  createVendorGrantRequestSchema,
  vendorGrantSchema,
} from "@/schemas/vendor-grant.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/vendor-grants",
  description:
    "Proactively grant vendor workspace access for the user's personal workspace. Creates or upgrades the grant to GRANTED and unparks tasks awaiting approval. Returns the resulting grant.",
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: createVendorGrantRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(vendorGrantSchema, "Grant created or upgraded"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const body = c.req.valid("json");
    const session = requireUserAuthContext(c.var.authContext);
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspace = await prisma.workspace.findUnique({
      where: { userId: resolvedUserId },
      select: { id: true },
    });

    if (!workspace) {
      throw badRequest("Personal workspace not found");
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: body.vendorId },
      select: { id: true },
    });

    if (!vendor) {
      throw notFound("Vendor not found");
    }

    const grant = await prisma.$transaction(async (tx) =>
      grantWorkspaceAccess(
        {
          vendorId: body.vendorId,
          workspaceId: workspace.id,
          resolvedById: session.userId,
        },
        tx,
      ),
    );

    return created(c, vendorGrantSchema.parse(toVendorGrantApiShape(grant)));
  });
}
