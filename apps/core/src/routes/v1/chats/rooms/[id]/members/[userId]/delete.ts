import { createRoute, z } from "@hono/zod-openapi";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { publishChatMembershipRevoked } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { leftChatRoomSchema } from "@/schemas/chat-room.schema";

import {
  membershipAccessForUser,
  requireChatRoomUserAccess,
} from "../../../helpers";
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

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/members/{userId}",
    description:
      "Remove a guest from an external channel. Caller must be a host-org room member (`access=member`). Only targets with `access=guest` may be removed this way; host members leave via `DELETE .../members/me`.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(leftChatRoomSchema, "Guest removed"),
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

    const { result, statusMessages } = await prisma.$transaction(async (tx) => {
      const room = await requireChatRoomUserAccess(
        roomId,
        userContext.userId,
        tx,
      );

      if (room.kind === "direct") {
        throw badRequest("Cannot remove members from a direct room.");
      }

      const callerAccess = membershipAccessForUser(
        room.userMembers,
        userContext.userId,
      );
      if (callerAccess === "guest") {
        throw forbidden("Guests cannot remove room members.");
      }

      const targetMembership = await tx.chatRoomUserMember.findUnique({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId: targetUserId,
          },
        },
        select: {
          access: true,
          user: { select: { id: true, name: true } },
        },
      });

      if (!targetMembership) {
        throw notFound("Room member not found");
      }

      if (targetMembership.access !== "guest") {
        throw badRequest(
          "Only guest members can be removed this way. Host members must leave themselves.",
        );
      }

      const targetName =
        targetMembership.user.name?.trim() || targetMembership.user.id;

      const createdStatus = await recordChannelMembershipStatus(tx, {
        roomId: room.id,
        roomKind: room.kind,
        changes: [
          {
            action: "left",
            subject: {
              type: "user",
              id: targetUserId,
              name: targetName,
            },
          },
        ],
      });

      await tx.chatRoomUserMember.deleteMany({
        where: { roomId: room.id, userId: targetUserId },
      });
      await tx.chatRoomReadState.deleteMany({
        where: { roomId: room.id, userId: targetUserId },
      });

      const remainingUserMemberCount = await tx.chatRoomUserMember.count({
        where: { roomId: room.id },
      });

      return {
        result: { id: room.id, remainingUserMemberCount },
        statusMessages: createdStatus,
      };
    });

    // Membership already committed. Status timeline and multi-tab revoke must
    // not gate each other (or fail the remove after the row is gone).
    const [statusResults, revokeResult] = await Promise.allSettled([
      Promise.all(
        statusMessages.map((message) =>
          publishChatRoomMessageRealtime(message, "create"),
        ),
      ),
      publishChatMembershipRevoked({
        userId: targetUserId,
        roomId: result.id,
        reason: "removed",
      }),
    ]);
    if (statusResults.status === "rejected") {
      console.error(
        "Failed to publish chat membership status after guest remove",
        statusResults.reason,
      );
    }
    if (revokeResult.status === "rejected") {
      console.error(
        "Failed to publish chat membership revoke after guest remove",
        revokeResult.reason,
      );
    }

    return ok(c, leftChatRoomSchema.parse(result));
  });
}
