import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomSchema } from "@/schemas/chat-room.schema";

import {
  getChatRoomPinnedMessageCounts,
  getChatRoomUnreadCounts,
  getChatRoomUnreadMentionCounts,
  mapChatRoom,
  requireChatRoomUserAccess,
} from "../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/unread",
    description:
      "Mark an organization chat room as unread for the current user without rewinding lastReadAt.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Chat room marked unread"),
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
    const { id } = c.req.valid("param");
    const markedUnreadAt = new Date();

    const { room, starredAt, mutedAt } = await prisma.$transaction(
      async (tx) => {
        const room = await requireChatRoomUserAccess(
          id,
          userContext.userId,
          tx,
        );

        // Keep existing lastReadAt when present; on create use now so we do not
        // invent a rewind that would flood unreadCount from room history.
        await tx.chatRoomReadState.upsert({
          where: {
            roomId_userId: {
              roomId: room.id,
              userId: userContext.userId,
            },
          },
          update: { markedUnreadAt },
          create: {
            roomId: room.id,
            userId: userContext.userId,
            lastReadAt: markedUnreadAt,
            markedUnreadAt,
          },
        });

        const membership = await tx.chatRoomUserMember.findUnique({
          where: {
            roomId_userId: {
              roomId: room.id,
              userId: userContext.userId,
            },
          },
          select: { starredAt: true, mutedAt: true },
        });

        return {
          room,
          starredAt: membership?.starredAt ?? null,
          mutedAt: membership?.mutedAt ?? null,
        };
      },
    );

    const [unreadCounts, unreadMentionCounts, pinnedCounts] = await Promise.all(
      [
        getChatRoomUnreadCounts([room.id], userContext.userId, prisma),
        getChatRoomUnreadMentionCounts([room.id], userContext.userId, prisma),
        getChatRoomPinnedMessageCounts([room.id], prisma),
      ],
    );

    return ok(
      c,
      chatRoomSchema.parse(
        mapChatRoom(room, userContext.userId, {
          unreadCount: unreadCounts.get(room.id) ?? 0,
          unreadMentionCount: unreadMentionCounts.get(room.id) ?? 0,
          starredAt,
          pinnedMessageCount: pinnedCounts.get(room.id) ?? 0,
          mutedAt,
          markedUnread: true,
        }),
      ),
    );
  });
}
