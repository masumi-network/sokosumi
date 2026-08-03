import { createRoute, z } from "@hono/zod-openapi";

import { unprocessableEntity } from "@/helpers/error";
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
    path: "/{id}/mute",
    description:
      "Mute an organization chat room for the current user. Cannot mute a pinned room.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Chat room muted"),
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
    const mutedAt = new Date();

    const room = await prisma.$transaction(async (tx) => {
      const room = await requireChatRoomUserAccess(id, userContext.userId, tx);

      const updated = await tx.chatRoomUserMember.updateMany({
        where: {
          roomId: room.id,
          userId: userContext.userId,
          pinnedAt: null,
        },
        data: { mutedAt },
      });
      if (updated.count === 0) {
        throw unprocessableEntity("Cannot mute a pinned room. Unpin it first.");
      }

      return room;
    });

    const [unreadCounts, unreadMentionCounts, sidebarFlags] = await Promise.all(
      [
        getChatRoomUnreadCounts([room.id], userContext.userId, prisma),
        getChatRoomUnreadMentionCounts([room.id], userContext.userId, prisma),
        getChatRoomSidebarFlags([room.id], userContext.userId, prisma),
      ],
    );
    const flags = sidebarFlags.get(room.id);

    return ok(
      c,
      chatRoomSchema.parse(
        mapChatRoom(room, userContext.userId, {
          unreadCount: unreadCounts.get(room.id) ?? 0,
          unreadMentionCount: unreadMentionCounts.get(room.id) ?? 0,
          pinnedAt: flags?.pinnedAt ?? null,
          mutedAt: flags?.mutedAt ?? mutedAt,
          markedUnread: flags?.markedUnread ?? false,
        }),
      ),
    );
  });
}
