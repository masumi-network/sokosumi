import { createRoute, z } from "@hono/zod-openapi";
import { NotificationKind } from "@sokosumi/database";
import { waitUntil } from "@vercel/functions";

import { publishChatRoomReadRealtime } from "@/helpers/chat-room-read-realtime";
import { publishClearedNotifications } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomSchema } from "@/schemas/chat-room.schema";

import {
  mapChatRoomWithSidebarFlags,
  requireChatRoomUserAccess,
} from "../../helpers";
import { getChatRoomUnreadCounts } from "../../room-unread";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/read",
    description:
      "Mark an organization chat room as read for the current user. Advances room lastReadAt and clears CHAT notifications. Does not clear per-thread look state — remaining unread thread replies still contribute to unreadCount.",
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
    let clearedIds: string[] = [];

    const room = await prisma.$transaction(async (tx) => {
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

      // Read before the write, because after it there is nothing left to
      // name. The reader's open tabs are told about each one below: a room
      // message stands in the notification center now, and a badge that
      // only ever heard about rows being written would keep counting rows
      // this room no longer has.
      clearedIds = (
        await tx.notification.findMany({
          where: {
            userId: userContext.userId,
            kind: NotificationKind.CHAT,
            referenceId: room.id,
            isRead: false,
          },
          select: { id: true },
        })
      ).map((notification) => notification.id);

      await tx.notification.updateMany({
        where: { id: { in: clearedIds } },
        data: {
          isRead: true,
          readAt,
        },
      });

      return room;
    });

    waitUntil(publishClearedNotifications(clearedIds));
    // Seen by: the room hears about this reader within a moment, so the other
    // side is not left waiting on a poll. Best effort — the publisher swallows
    // its own failures and the next room payload carries the same mark.
    waitUntil(
      publishChatRoomReadRealtime({
        roomId: room.id,
        userId: userContext.userId,
        lastReadAt: readAt,
      }),
    );

    // Top-level unreads are cleared by lastReadAt; thread replies still use
    // look baseline. Return the real dual-baseline count so the sidebar does
    // not optimistically hide unlooked threads. Mention badges are cleared
    // with the CHAT notifications above.
    const unreadCounts = await getChatRoomUnreadCounts(
      [room.id],
      userContext.userId,
      prisma,
    );

    return ok(
      c,
      chatRoomSchema.parse(
        await mapChatRoomWithSidebarFlags(room, userContext.userId, prisma, {
          unreadCount: unreadCounts.get(room.id) ?? 0,
          unreadMentionCount: 0,
        }),
      ),
    );
  });
}
