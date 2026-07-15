import { createRoute, z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { toVendorGrantApiShape } from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  vendorGrantSchema,
  vendorGrantStatusSchema,
  vendorGrantsSchema,
} from "@/schemas/vendor-grant.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const query = z.object({
  status: vendorGrantStatusSchema.optional(),
  vendorId: z.string().uuid().optional(),
});

const route = createRoute({
  method: "get",
  path: "/vendor-grants",
  description:
    "List vendor workspace grants for the user's personal workspace (path `me` or accessible user id)",
  tags: ["Users"],
  request: { params, query },
  responses: {
    200: jsonSuccessResponse(vendorGrantsSchema, "List vendor grants"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const filters = c.req.valid("query");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspace = await prisma.workspace.findUnique({
      where: { userId: resolvedUserId },
      select: { id: true },
    });

    if (!workspace) {
      throw badRequest("Personal workspace not found");
    }

    const grants = await prisma.vendorGrant.findMany({
      where: {
        workspaceId: workspace.id,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
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
          vendorGrantSchema.parse(toVendorGrantApiShape(grant)),
        ),
      ),
    );
  });
}
