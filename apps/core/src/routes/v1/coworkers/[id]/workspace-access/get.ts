import { createRoute } from "@hono/zod-openapi";

import { toCoworkerWorkspaceAccessApiShape } from "@/helpers/coworker-workspace-access";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole, requireUserAuthContext } from "@/middleware/auth";
import { coworkerWorkspaceAccessesSchema } from "@/schemas/coworker-workspace-access.schema";

import { paramsSchema } from "../schema";

const route = createRoute({
  method: "get",
  path: "/{id}/workspace-access",
  operationId: "listCoworkerWorkspaceAccess",
  description:
    "List workspace access rows for a coworker. Platform admin or vendor admin for the coworker's vendor.",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      coworkerWorkspaceAccessesSchema,
      "List of coworker workspace access rows",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userAuth = requireUserAuthContext(c.var.authContext);
    const { id: coworkerId } = c.req.valid("param");

    const coworker = await prisma.coworker.findFirst({
      where: { id: coworkerId },
      select: { id: true, vendorId: true },
    });

    if (!coworker) {
      throw notFound("Coworker not found");
    }

    if (!hasAdminRole(userAuth.role)) {
      await requireVendorAdminMembership(userAuth.userId, coworker.vendorId);
    }

    const rows = await prisma.coworkerWorkspaceAccess.findMany({
      where: { coworkerId },
      orderBy: { createdAt: "desc" },
    });

    return ok(
      c,
      coworkerWorkspaceAccessesSchema.parse(
        rows.map(toCoworkerWorkspaceAccessApiShape),
      ),
    );
  });
}
