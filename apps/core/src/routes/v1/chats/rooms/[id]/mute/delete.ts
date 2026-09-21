import { createRoute, z } from "@hono/zod-openapi";

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
  unreadAttention,
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
    method: "delete",
    path: "/{id}/mute",
    description: "Unmute an organization chat room for the current user.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomSchema, "Chat room unmuted"),
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

    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );

    await prisma.chatRoomUserMember.update({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: userContext.userId,
        },
      },
      data: { mutedAt: null },
    });

    const [unreadCounts, unreadMentionCounts] = await Promise.all([
      getChatRoomUnreadCounts([room.id], userContext.userId, prisma),
      getChatRoomUnreadMentionCounts([room.id], userContext.userId, prisma),
    ]);

    return ok(
      c,
      chatRoomSchema.parse(
        await mapChatRoomWithSidebarFlags(room, userContext.userId, prisma, {
          ...unreadAttention(unreadCounts.get(room.id)),
          unreadMentionCount: unreadMentionCounts.get(room.id) ?? 0,
        }),
      ),
    );
  });
}
