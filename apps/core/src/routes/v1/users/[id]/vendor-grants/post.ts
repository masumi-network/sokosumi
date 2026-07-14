import { createRoute, z } from "@hono/zod-openapi";
import { VendorGrantStatus, VendorPermission } from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  toApiVendorPermission,
  toPrismaVendorPermission,
  unparkTasksForGrant,
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
  vendorGrantSchema,
} from "@/schemas/vendor-grant.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/vendor-grants",
  description:
    "Proactively grant a vendor permission for the user's personal workspace. Granting task:create also unparks tasks awaiting that grant.",
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
    201: jsonSuccessResponse(vendorGrantSchema, "Grant created"),
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

    const permission = toPrismaVendorPermission(body.permission);
    const now = new Date();

    const grant = await prisma.$transaction(async (tx) => {
      const upserted = await tx.vendorGrant.upsert({
        where: {
          vendorId_workspaceId_permission: {
            vendorId: body.vendorId,
            workspaceId: workspace.id,
            permission,
          },
        },
        create: {
          vendorId: body.vendorId,
          workspaceId: workspace.id,
          permission,
          status: VendorGrantStatus.GRANTED,
          resolvedAt: now,
          resolvedById: resolvedUserId,
        },
        update: {
          status: VendorGrantStatus.GRANTED,
          resolvedAt: now,
          resolvedById: resolvedUserId,
        },
        include: {
          vendor: { select: { name: true, slug: true } },
        },
      });

      if (upserted.permission === VendorPermission.task_create) {
        await unparkTasksForGrant(upserted.id, tx);
      }

      return upserted;
    });

    return created(
      c,
      vendorGrantSchema.parse({
        id: grant.id,
        vendorId: grant.vendorId,
        vendorName: grant.vendor.name,
        vendorSlug: grant.vendor.slug,
        workspaceId: grant.workspaceId,
        permission: toApiVendorPermission(grant.permission),
        status: grant.status,
        requestedByUserId: grant.requestedByUserId,
        resolvedAt: grant.resolvedAt,
        resolvedById: grant.resolvedById,
        createdAt: grant.createdAt,
        updatedAt: grant.updatedAt,
      }),
    );
  });
}
