import { createRoute, z } from "@hono/zod-openapi";

import { notFound, unprocessableEntity } from "@/helpers/error";
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
import {
  getChatRoomUnreadCounts,
  getChatRoomUnreadMentionCounts,
} from "../../room-unread";

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
    path: "/{id}/mute",
    description:
      "Mute an organization chat room for the current user. Cannot mute a starred room.",
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

    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );

    const updated = await prisma.chatRoomUserMember.updateMany({
      where: {
        roomId: room.id,
        userId: userContext.userId,
        starredAt: null,
      },
      data: { mutedAt },
    });
    if (updated.count === 0) {
      const membership = await prisma.chatRoomUserMember.findUnique({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId: userContext.userId,
          },
        },
        select: { starredAt: true },
      });
      if (membership?.starredAt != null) {
        throw unprocessableEntity(
          "Cannot mute a starred room. Unstar it first.",
        );
      }
      throw notFound("Room not found");
    }

    const [unreadCounts, unreadMentionCounts] = await Promise.all([
      getChatRoomUnreadCounts([room.id], userContext.userId, prisma),
      getChatRoomUnreadMentionCounts([room.id], userContext.userId, prisma),
    ]);

    return ok(
      c,
      chatRoomSchema.parse(
        await mapChatRoomWithSidebarFlags(room, userContext.userId, prisma, {
          unreadCount: unreadCounts.get(room.id) ?? 0,
          unreadMentionCount: unreadMentionCounts.get(room.id) ?? 0,
        }),
      ),
    );
  });
}
