import { createRoute, z } from "@hono/zod-openapi";

import {
  listCoworkerAccessForWorkspace,
  toCoworkerWorkspaceAccessApiShape,
} from "@/helpers/coworker-workspace-access";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  coworkerWorkspaceAccessesSchema,
  coworkerWorkspaceAccessSchema,
} from "@/schemas/coworker-workspace-access.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/coworker-access",
  description:
    "List coworker workspace access rows for the user's personal workspace. Owner (self) only.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      coworkerWorkspaceAccessesSchema,
      "List coworker workspace access",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspace = await prisma.workspace.findUnique({
      where: { userId: resolvedUserId },
      select: { id: true },
    });

    if (!workspace) {
      throw badRequest("Personal workspace not found");
    }

    const rows = await listCoworkerAccessForWorkspace(workspace.id);

    return ok(
      c,
      coworkerWorkspaceAccessesSchema.parse(
        rows.map((row) =>
          coworkerWorkspaceAccessSchema.parse(
            toCoworkerWorkspaceAccessApiShape(row),
          ),
        ),
      ),
    );
  });
}
