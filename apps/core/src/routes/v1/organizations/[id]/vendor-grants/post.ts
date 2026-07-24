import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { created } from "@/helpers/response";
import {
  grantWorkspaceAccess,
  toVendorGrantApiShape,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  createVendorGrantRequestSchema,
  vendorGrantSchema,
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
    "Proactively grant vendor workspace access for the organization (owner/admin). Creates or upgrades the grant to GRANTED and unparks tasks awaiting approval. Returns the resulting grant.",
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
    201: jsonSuccessResponse(vendorGrantSchema, "Grant created or upgraded"),
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
          resolvedById: userContext.userId,
        },
        tx,
      ),
    );

    return created(c, vendorGrantSchema.parse(toVendorGrantApiShape(grant)));
  });
}
