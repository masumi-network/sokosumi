import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  toVendorGrantApiShape,
  upsertGrantedVendorPermissions,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  createVendorGrantRequestSchema,
  vendorGrantsSchema,
} from "@/schemas/vendor-grant.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/vendor-grants",
  description:
    "Proactively grant one or more vendor permissions for the user's personal workspace. Creates or upgrades each row to GRANTED in a single transaction. Granting task:create also unparks tasks awaiting that grant. Returns all resulting grants for the request.",
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
    201: jsonSuccessResponse(vendorGrantsSchema, "Grants created or upgraded"),
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
      select: { id: true, name: true, slug: true },
    });

    if (!vendor) {
      throw notFound("Vendor not found");
    }

    const grants = await prisma.$transaction(async (tx) =>
      upsertGrantedVendorPermissions(
        {
          vendorId: body.vendorId,
          workspaceId: workspace.id,
          permissions: body.permissions,
          resolvedById: resolvedUserId,
        },
        tx,
      ),
    );

    return created(
      c,
      vendorGrantsSchema.parse(grants.map(toVendorGrantApiShape)),
    );
  });
}
