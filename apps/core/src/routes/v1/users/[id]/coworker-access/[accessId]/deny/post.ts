import { createRoute, z } from "@hono/zod-openapi";

import {
  denyCoworkerWorkspaceAccess,
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
import { coworkerWorkspaceAccessSchema } from "@/schemas/coworker-workspace-access.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  accessId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "accessId", in: "path" },
      description: "Coworker workspace access ID",
    }),
});

const route = createRoute({
  method: "post",
  path: "/coworker-access/{accessId}/deny",
  description:
    "Deny a PENDING coworker workspace access for the user's personal workspace.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      coworkerWorkspaceAccessSchema,
      "Coworker workspace access denied",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { accessId } = c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspace = await prisma.workspace.findUnique({
      where: { userId: resolvedUserId },
      select: { id: true },
    });

    if (!workspace) {
      throw badRequest("Personal workspace not found");
    }

    const access = await prisma.$transaction(async (tx) =>
      denyCoworkerWorkspaceAccess(
        {
          accessId,
          workspaceId: workspace.id,
          resolvedById: userContext.userId,
        },
        tx,
      ),
    );

    return ok(
      c,
      coworkerWorkspaceAccessSchema.parse(
        toCoworkerWorkspaceAccessApiShape(access),
      ),
    );
  });
}
