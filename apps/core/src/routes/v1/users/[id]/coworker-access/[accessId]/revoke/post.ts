import { createRoute, z } from "@hono/zod-openapi";

import { publishChatRoomMembershipStatusMessagesBestEffort } from "@/helpers/chat-room-message-realtime";
import {
  revokeCoworkerWorkspaceAccess,
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
  path: "/coworker-access/{accessId}/revoke",
  description:
    "Revoke a GRANTED coworker workspace access for the user's personal workspace.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      coworkerWorkspaceAccessSchema,
      "Coworker workspace access revoked",
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

    const { access, membershipStatusMessages } = await prisma.$transaction(
      async (tx) =>
        revokeCoworkerWorkspaceAccess(
          {
            accessId,
            workspaceId: workspace.id,
            resolvedById: userContext.userId,
          },
          tx,
        ),
    );

    // Membership already committed; status publish must not fail the revoke.
    await publishChatRoomMembershipStatusMessagesBestEffort(
      membershipStatusMessages,
      "chat membership status after coworker access revoke",
    );

    return ok(
      c,
      coworkerWorkspaceAccessSchema.parse(
        toCoworkerWorkspaceAccessApiShape(access),
      ),
    );
  });
}
