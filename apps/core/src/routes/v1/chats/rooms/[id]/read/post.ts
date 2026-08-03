import { createRoute, z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomSchema } from "@/schemas/chat-room.schema";

import { mapChatRoom, requireChatRoomUserAccess } from "../../helpers";

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
    path: "/{id}/read",
    description: "Mark an organization chat room as read for the current user.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Chat room marked read"),
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
    const readAt = new Date();

    const { room, pinnedAt } = await prisma.$transaction(async (tx) => {
      const room = await requireChatRoomUserAccess(id, userContext.userId, tx);

      await tx.chatRoomReadState.upsert({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId: userContext.userId,
          },
        },
        update: { lastReadAt: readAt, markedUnreadAt: null },
        create: {
          roomId: room.id,
          userId: userContext.userId,
          lastReadAt: readAt,
          markedUnreadAt: null,
        },
      });

      await tx.notification.updateMany({
        where: {
          userId: userContext.userId,
          kind: NotificationKind.CHAT,
          referenceId: room.id,
          isRead: false,
        },
        data: {
          isRead: true,
          readAt,
        },
      });

      const membership = await tx.chatRoomUserMember.findUnique({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId: userContext.userId,
          },
        },
        select: { pinnedAt: true },
      });

      return { room, pinnedAt: membership?.pinnedAt ?? null };
    });

    return ok(
      c,
      chatRoomSchema.parse(
        mapChatRoom(room, userContext.userId, {
          unreadCount: 0,
          unreadMentionCount: 0,
          pinnedAt,
          markedUnread: false,
        }),
      ),
    );
  });
}
