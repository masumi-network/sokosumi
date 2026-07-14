import { createRoute, z } from "@hono/zod-openapi";
import { VendorGrantStatus } from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  cancelParkedTasksForGrant,
  toApiVendorPermission,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { vendorGrantSchema } from "@/schemas/vendor-grant.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  grantId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "grantId", in: "path" },
    }),
});

const route = createRoute({
  method: "post",
  path: "/vendor-grants/{grantId}/deny",
  description:
    "Deny a PENDING vendor workspace grant for the user's personal workspace. Cancels parked tasks linked to this grant.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(vendorGrantSchema, "Grant denied"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { grantId } = c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspace = await prisma.workspace.findUnique({
      where: { userId: resolvedUserId },
      select: { id: true },
    });

    if (!workspace) {
      throw badRequest("Personal workspace not found");
    }

    const grant = await prisma.$transaction(async (tx) => {
      const existing = await tx.vendorGrant.findFirst({
        where: { id: grantId, workspaceId: workspace.id },
        include: { vendor: { select: { name: true, slug: true } } },
      });

      if (!existing) {
        throw notFound("Vendor grant not found");
      }

      if (existing.status !== VendorGrantStatus.PENDING) {
        throw badRequest("Only PENDING grants can be denied");
      }

      const updated = await tx.vendorGrant.update({
        where: { id: grantId },
        data: {
          status: VendorGrantStatus.DENIED,
          resolvedAt: new Date(),
          resolvedById: resolvedUserId,
        },
        include: { vendor: { select: { name: true, slug: true } } },
      });

      await cancelParkedTasksForGrant(updated.id, tx);

      return updated;
    });

    return ok(
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
