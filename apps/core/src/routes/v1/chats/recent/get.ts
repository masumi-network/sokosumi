import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRecentSokoBotMessageSchema } from "@/schemas/chat-room.schema";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rooms returned at most: what Home's day list shows. */
export const RECENT_SOKO_BOT_ROOM_LIMIT = 8;

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/",
    description:
      "The caller's newest own message, top-level or Thread reply, in each room with a Soko Bot from the last 24 hours. Only live rooms of the active workspace (none: the personal one) that the caller is a member of. Newest first, at most 8 rooms. Home lists these as the reader's chats of the day.",
    tags: ["Chat Rooms"],
    responses: {
      200: jsonSuccessResponse(
        z.array(chatRecentSokoBotMessageSchema),
        "The caller's recent Soko Bot chats",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId, organizationId } = requireUserAuthContext(
      c.var.authContext,
    );
    const own = {
      senderUserId: userId,
      deletedAt: null,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
    };
    // Grouped in the database, so a room where the caller wrote is never
    // crowded out by rooms where only others or the bot did.
    const groups = await prisma.chatRoomMessage.groupBy({
      by: ["roomId"],
      where: {
        ...own,
        room: {
          archivedAt: null,
          organizationId: organizationId ?? null,
          userMembers: { some: { userId } },
          sokoBotMembers: { some: {} },
        },
      },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: RECENT_SOKO_BOT_ROOM_LIMIT,
    });
    const messages = groups.length
      ? await prisma.chatRoomMessage.findMany({
          where: {
            ...own,
            OR: groups.map((group) => ({
              roomId: group.roomId,
              createdAt: group._max.createdAt ?? undefined,
            })),
          },
          select: {
            id: true,
            roomId: true,
            parentMessageId: true,
            content: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : [];
    // Two messages in one millisecond: keep one per room.
    const byRoom = new Map(
      messages.toReversed().map((message) => [message.roomId, message]),
    );
    return ok(
      c,
      z.array(chatRecentSokoBotMessageSchema).parse(
        groups.flatMap((group) => {
          const message = byRoom.get(group.roomId);
          return message
            ? [
                {
                  roomId: message.roomId,
                  messageId: message.id,
                  parentMessageId: message.parentMessageId,
                  content: message.content,
                  createdAt: message.createdAt,
                },
              ]
            : [];
        }),
      ),
    );
  });
}
