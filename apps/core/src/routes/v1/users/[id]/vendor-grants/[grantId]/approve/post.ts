import { createRoute, z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  approveVendorGrantInWorkspace,
  toVendorGrantApiShape,
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
      description: "Vendor grant ID",
    }),
});

const route = createRoute({
  method: "post",
  path: "/vendor-grants/{grantId}/approve",
  description:
    "Approve a vendor workspace grant for the user's personal workspace. Unparks tasks awaiting this grant.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(vendorGrantSchema, "Grant approved"),
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

    const grant = await prisma.$transaction(async (tx) =>
      approveVendorGrantInWorkspace(
        {
          grantId,
          workspaceId: workspace.id,
          resolvedById: resolvedUserId,
        },
        tx,
      ),
    );

    return ok(c, vendorGrantSchema.parse(toVendorGrantApiShape(grant)));
  });
}
