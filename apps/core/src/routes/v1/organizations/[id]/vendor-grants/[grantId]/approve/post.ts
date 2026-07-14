import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole, VendorGrantStatus } from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import {
  toApiVendorPermission,
  unparkTasksForGrant,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { vendorGrantSchema } from "@/schemas/vendor-grant.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
  }),
  grantId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "grantId", in: "path" },
      description: "Vendor grant ID",
    }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/vendor-grants/{grantId}/approve",
  description:
    "Approve a vendor workspace grant (PENDING / DENIED / REVOKED → GRANTED). Unparks tasks awaiting this grant. Owner/admin only.",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(vendorGrantSchema, "Grant approved"),
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

      if (existing.status === VendorGrantStatus.GRANTED) {
        return existing;
      }

      if (
        existing.status !== VendorGrantStatus.PENDING &&
        existing.status !== VendorGrantStatus.DENIED &&
        existing.status !== VendorGrantStatus.REVOKED
      ) {
        throw badRequest(`Cannot approve grant in status ${existing.status}`);
      }

      const now = new Date();
      const updated = await tx.vendorGrant.update({
        where: { id: grantId },
        data: {
          status: VendorGrantStatus.GRANTED,
          resolvedAt: now,
          resolvedById: userContext.userId,
        },
        include: { vendor: { select: { name: true, slug: true } } },
      });

      await unparkTasksForGrant(updated.id, tx);

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
