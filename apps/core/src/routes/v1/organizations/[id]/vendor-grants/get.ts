import { createRoute, z } from "@hono/zod-openapi";
import { VendorGrantStatus } from "@sokosumi/database";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import {
  toApiVendorPermission,
  toPrismaVendorPermission,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  vendorGrantSchema,
  vendorGrantStatusSchema,
  vendorGrantsSchema,
  vendorPermissionSchema,
} from "@/schemas/vendor-grant.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const query = z.object({
  status: vendorGrantStatusSchema.optional(),
  vendorId: z.string().uuid().optional(),
  permission: vendorPermissionSchema.optional(),
});

const route = createRoute({
  method: "get",
  path: "/{id}/vendor-grants",
  description: "List vendor workspace grants for an organization (any member)",
  tags: ["Organizations"],
  request: { params, query },
  responses: {
    200: jsonSuccessResponse(vendorGrantsSchema, "List vendor grants"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const filters = c.req.valid("query");

    await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
    });

    const workspace = await prisma.workspace.findUnique({
      where: { organizationId: id },
      select: { id: true },
    });

    if (!workspace) {
      throw badRequest("Organization workspace not found");
    }

    const grants = await prisma.vendorGrant.findMany({
      where: {
        workspaceId: workspace.id,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
        ...(filters.permission
          ? { permission: toPrismaVendorPermission(filters.permission) }
          : {}),
      },
      include: {
        vendor: { select: { name: true, slug: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    return ok(
      c,
      vendorGrantsSchema.parse(
        grants.map((grant) =>
          vendorGrantSchema.parse({
            id: grant.id,
            vendorId: grant.vendorId,
            vendorName: grant.vendor.name,
            vendorSlug: grant.vendor.slug,
            workspaceId: grant.workspaceId,
            permission: toApiVendorPermission(grant.permission),
            status: grant.status as VendorGrantStatus,
            requestedByUserId: grant.requestedByUserId,
            resolvedAt: grant.resolvedAt,
            resolvedById: grant.resolvedById,
            createdAt: grant.createdAt,
            updatedAt: grant.updatedAt,
          }),
        ),
      ),
    );
  });
}
