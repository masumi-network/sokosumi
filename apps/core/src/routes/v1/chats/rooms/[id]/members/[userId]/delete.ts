import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { leftChatRoomSchema } from "@/schemas/chat-room.schema";

import {
  publishChannelMembershipEffects,
  removeOwnedSokoBotsFromChannel,
  requireChannelRosterAccess,
} from "../../../channel-membership";
import { isOrganizationOwnerOrAdmin } from "../../../helpers";
import { recordChannelMembershipStatus } from "../../../membership-status";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  userId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "userId", in: "path" },
      example: "user_guest",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/members/{userId}",
    description:
      "Remove someone else from a Channel. Any host member (`access=member`) may remove a Guest; only an organization owner or admin may remove a host member. Their own Soko Bots leave the Channel with them. To leave yourself, use `DELETE .../members/me`. Matched channels are managed by Sokosumi.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(leftChatRoomSchema, "Member removed"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id: roomId, userId: targetUserId } = c.req.valid("param");

    if (targetUserId === userContext.userId) {
      throw badRequest("Use DELETE .../members/me to leave a room yourself.");
    }

    const { result, statusMessages, mentionMessageIds } =
      await prisma.$transaction(async (tx) => {
        const { room, organizationId, actor } =
          await requireChannelRosterAccess(tx, roomId, userContext.userId);

        const target = room.userMembers.find(
          (member) => member.userId === targetUserId,
        );
        if (!target) {
          throw notFound("Room member not found");
        }

        if (target.access !== "guest") {
          const { role } = await resolveMemberOrganizationById({
            id: organizationId,
            userId: userContext.userId,
            tx,
          });
          if (!isOrganizationOwnerOrAdmin(role)) {
            throw forbidden(
              "Only an organization owner or admin can remove a member.",
            );
          }
        }

        await tx.chatRoomUserMember.deleteMany({
          where: { roomId: room.id, userId: targetUserId },
        });
        await tx.chatRoomReadState.deleteMany({
          where: { roomId: room.id, userId: targetUserId },
        });
        const bots = await removeOwnedSokoBotsFromChannel(
          tx,
          room,
          targetUserId,
          actor,
        );

        const statusMessages = await recordChannelMembershipStatus(tx, {
          roomId: room.id,
          roomKind: room.kind,
          changes: [
            {
              action: "left",
              subject: {
                type: "user",
                id: targetUserId,
                name: target.user.name.trim() || targetUserId,
              },
              actor,
            },
            ...bots.changes,
          ],
        });

        const remainingUserMemberCount = await tx.chatRoomUserMember.count({
          where: { roomId: room.id },
        });

        return {
          result: { id: room.id, remainingUserMemberCount },
          statusMessages,
          mentionMessageIds: bots.mentionMessageIds,
        };
      });

    await publishChannelMembershipEffects({
      roomId: result.id,
      statusMessages,
      removedUserIds: [targetUserId],
      mentionMessageIds,
    });

    return ok(c, leftChatRoomSchema.parse(result));
  });
}
