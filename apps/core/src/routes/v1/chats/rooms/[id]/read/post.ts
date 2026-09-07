import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";
import { waitUntil } from "@vercel/functions";

import { publishNotificationRow } from "@/helpers/notifications";
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

/**
 * Tell the reader's open tabs that these rows are read.
 *
 * The row is published rather than a bare id, because a tab holding it
 * replaces what it holds and a tab that never loaded it can tell a row it
 * already counted from a new one. Rows the app never shows are published too
 * and dropped by the reader, which is cheaper than asking here which surface
 * each one belongs to.
 */
async function publishClearedNotifications(ids: string[]): Promise<void> {
  // Guarded here rather than at the call, because the reader has already been
  // answered: this runs after the response, and a read that fails must not
  // leave a rejected promise behind it. The rows come back on the next fetch,
  // so the cost of losing this is a bell that lags until then.
  try {
    const cleared = await prisma.notification.findMany({
      where: { id: { in: ids } },
    });

    for (const notification of cleared) {
      // No banner: nothing arrived. This says one stopped waiting.
      await publishNotificationRow(
        notification,
        { inApp: notification.inApp, osBanner: false },
        false,
      );
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: { notificationIds: ids, errorType: "publish-cleared-chat-rows" },
    });
  }
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const readAt = new Date();
    let clearedIds: string[] = [];

    const { room, starredAt, mutedAt } = await prisma.$transaction(
      async (tx) => {
        const room = await requireChatRoomUserAccess(
          id,
          userContext.userId,
          tx,
        );

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

    if (clearedIds.length > 0) {
      waitUntil(publishClearedNotifications(clearedIds));
    }

    // Top-level unreads are cleared by lastReadAt; thread replies still use
    // look baseline. Return the real dual-baseline count so the sidebar does
    // not optimistically hide unlooked threads.
    const [unreadCounts, pinnedCounts] = await Promise.all([
      getChatRoomUnreadCounts([room.id], userContext.userId, prisma),
      getChatRoomPinnedMessageCounts([room.id], prisma),
    ]);

    return ok(
      c,
      chatRoomSchema.parse(
        mapChatRoom(room, userContext.userId, {
          unreadCount: unreadCounts.get(room.id) ?? 0,
          unreadMentionCount: 0,
          starredAt,
          pinnedMessageCount: pinnedCounts.get(room.id) ?? 0,
          mutedAt,
          markedUnread: false,
        }),
      ),
    );
  });
}
