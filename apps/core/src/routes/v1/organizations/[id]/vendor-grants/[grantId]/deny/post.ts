import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import {
  denyVendorGrantInWorkspace,
  toVendorGrantApiShape,
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
  path: "/{id}/vendor-grants/{grantId}/deny",
  description:
    "Deny a PENDING vendor workspace grant. Cancels parked tasks linked to this grant. Owner/admin only.",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(vendorGrantSchema, "Grant denied"),
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

    const grant = await prisma.$transaction(async (tx) =>
      denyVendorGrantInWorkspace(
        {
          grantId,
          workspaceId: workspace.id,
          resolvedById: userContext.userId,
        },
        tx,
      ),
    );

    return ok(c, vendorGrantSchema.parse(toVendorGrantApiShape(grant)));
  });
}
