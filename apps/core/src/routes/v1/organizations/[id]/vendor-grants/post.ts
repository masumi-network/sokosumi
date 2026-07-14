import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { created } from "@/helpers/response";
import {
  toVendorGrantApiShape,
  upsertGrantedVendorPermissions,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  createVendorGrantRequestSchema,
  vendorGrantsSchema,
} from "@/schemas/vendor-grant.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/vendor-grants",
  description:
    "Proactively grant one or more vendor permissions for the organization workspace (owner/admin). Creates or upgrades each row to GRANTED in a single transaction. Granting task:create also unparks tasks awaiting that grant. Returns all resulting grants for the request.",
  tags: ["Organizations"],
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

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

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
          resolvedById: userContext.userId,
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
