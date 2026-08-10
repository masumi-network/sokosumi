import { createRoute } from "@hono/zod-openapi";

import { publishChatRoomMembershipStatusMessagesBestEffort } from "@/helpers/chat-room-message-realtime";
import {
  forceRevokeCoworkerWorkspaceAccessByPair,
  resolveCoworkerAccessTargetWorkspaceId,
  toCoworkerWorkspaceAccessApiShape,
} from "@/helpers/coworker-workspace-access";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireVendorAdminMembership } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole, requireUserAuthContext } from "@/middleware/auth";
import {
  coworkerWorkspaceAccessSchema,
  coworkerWorkspaceAccessWorkspaceIdBodySchema,
} from "@/schemas/coworker-workspace-access.schema";

import { paramsSchema } from "../../schema";

const route = createRoute({
  method: "post",
  path: "/{id}/workspace-access/revoke",
  operationId: "revokeCoworkerWorkspaceAccessAsPlatformAdmin",
  description:
    "Revoke GRANTED coworker workspace access. Platform admin, or vendor admin for this coworker. Does not require the workspace owner. Body: exactly one of workspaceId, userId, organizationId, email, or organizationSlug. Does not create missing workspaces.",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: coworkerWorkspaceAccessWorkspaceIdBodySchema,
        },
      },
    },
  },
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

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userAuth = requireUserAuthContext(c.var.authContext);
    const { id: coworkerId } = c.req.valid("param");
    const target = c.req.valid("json");
    const isPlatformAdmin = hasAdminRole(userAuth.role);

    // Authz + resolve + lock + status flip share one transaction so membership
    // and FOR UPDATE cannot race against demotion / concurrent revokes.
    // Find-only resolve: never create workspaces on ops undo.
    const { access, membershipStatusMessages } = await prisma.$transaction(
      async (tx) => {
        const coworker = await tx.coworker.findFirst({
          where: { id: coworkerId },
          select: { id: true, vendorId: true },
        });
        if (!coworker) {
          throw notFound("Coworker not found");
        }

        if (!isPlatformAdmin) {
          await requireVendorAdminMembership(
            userAuth.userId,
            coworker.vendorId,
            tx,
          );
        }

        const workspaceId = await resolveCoworkerAccessTargetWorkspaceId(
          target,
          { createIfMissing: false },
          tx,
        );
        return forceRevokeCoworkerWorkspaceAccessByPair(
          {
            coworkerId,
            workspaceId,
            resolvedById: userAuth.userId,
          },
          tx,
        );
      },
    );

    // Membership already committed; status publish must not fail the revoke.
    await publishChatRoomMembershipStatusMessagesBestEffort(
      membershipStatusMessages,
      "chat membership status after coworker access force-revoke",
    );

    return ok(
      c,
      coworkerWorkspaceAccessSchema.parse(
        toCoworkerWorkspaceAccessApiShape(access),
      ),
    );
  });
}
