import { createRoute, z } from "@hono/zod-openapi";

import { notFound, unprocessableEntity } from "@/helpers/error";
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
  getChatRoomSidebarFlags,
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
    path: "/{id}/star",
    description:
      "Star an organization chat room for the current user. Cannot star a muted room.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Chat room starred"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const starredAt = new Date();

    const room = await prisma.$transaction(async (tx) => {
      const room = await requireChatRoomUserAccess(id, userContext.userId, tx);

      const updated = await tx.chatRoomUserMember.updateMany({
        where: {
          roomId: room.id,
          userId: userContext.userId,
          mutedAt: null,
        },
        data: { starredAt },
      });
      if (updated.count === 0) {
        const membership = await tx.chatRoomUserMember.findUnique({
          where: {
            roomId_userId: {
              roomId: room.id,
              userId: userContext.userId,
            },
          },
          select: { mutedAt: true },
        });
        if (membership?.mutedAt != null) {
          throw unprocessableEntity(
            "Cannot star a muted room. Unmute it first.",
          );
        }
        throw notFound("Room not found");
      }

      return room;
    });

    const [unreadCounts, unreadMentionCounts, sidebarFlags, pinnedCounts] =
      await Promise.all([
        getChatRoomUnreadCounts([room.id], userContext.userId, prisma),
        getChatRoomUnreadMentionCounts([room.id], userContext.userId, prisma),
        getChatRoomSidebarFlags([room.id], userContext.userId, prisma),
        getChatRoomPinnedMessageCounts([room.id], prisma),
      ]);
    const flags = sidebarFlags.get(room.id);

    return ok(
      c,
      chatRoomSchema.parse(
        mapChatRoom(room, userContext.userId, {
          unreadCount: unreadCounts.get(room.id) ?? 0,
          unreadMentionCount: unreadMentionCounts.get(room.id) ?? 0,
          starredAt: flags?.starredAt ?? starredAt,
          pinnedMessageCount: pinnedCounts.get(room.id) ?? 0,
          mutedAt: flags?.mutedAt ?? null,
          markedUnread: flags?.markedUnread ?? false,
        }),
      ),
    );
  });
}
