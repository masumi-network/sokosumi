import { createRoute, z } from "@hono/zod-openapi";
import {
  MemberRole,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import {
  cancelParkedTasksForGrant,
  toApiVendorPermission,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { vendorGrantSchema } from "@/schemas/vendor-grant.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
  }),
  grantId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "grantId", in: "path" },
    }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/vendor-grants/{grantId}/revoke",
  description:
    "Revoke a GRANTED vendor grant. Cancels still-parked tasks when revoking task:create. Owner/admin only.",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(vendorGrantSchema, "Grant revoked"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id, grantId } = c.req.valid("param");

    await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const workspace = await prisma.workspace.findUnique({
      where: { organizationId: id },
      select: { id: true },
    });

    if (!workspace) {
      throw badRequest("Organization workspace not found");
    }

    const grant = await prisma.$transaction(async (tx) => {
      const existing = await tx.vendorGrant.findFirst({
        where: { id: grantId, workspaceId: workspace.id },
        include: { vendor: { select: { name: true, slug: true } } },
      });

      if (!existing) {
        throw notFound("Vendor grant not found");
      }

      if (existing.status !== VendorGrantStatus.GRANTED) {
        throw badRequest("Only GRANTED grants can be revoked");
      }

      const updated = await tx.vendorGrant.update({
        where: { id: grantId },
        data: {
          status: VendorGrantStatus.REVOKED,
          resolvedAt: new Date(),
          resolvedById: userContext.userId,
        },
        include: { vendor: { select: { name: true, slug: true } } },
      });

      if (updated.permission === VendorPermission.task_create) {
        await cancelParkedTasksForGrant(updated.id, tx);
      }

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
