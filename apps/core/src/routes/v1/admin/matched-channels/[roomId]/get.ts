import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminMatchedChannelDetailSchema,
  adminMatchedChannelRoomParamsSchema,
} from "@/schemas/admin.schema";
import { CHAT_ROOM_ACCESS } from "@/schemas/chat-room.schema";

const route = createRoute({
  method: "get",
  path: "/{roomId}",
  operationId: "getAdminMatchedChannel",
  description:
    "Get one matched channel including member roster (admin only). Works for live and soft-archived org-less matched channels. Returns 404 when the room is missing or not an org-less matched channel.",
  tags: ["Admin"],
  request: {
    params: adminMatchedChannelRoomParamsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminMatchedChannelDetailSchema,
      "Matched channel detail",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { roomId } = c.req.valid("param");

    const room = await prisma.chatRoom.findFirst({
      where: {
        id: roomId,
        organizationId: null,
        kind: "channel",
        discoverability: "matched",
      },
      select: {
        id: true,
        name: true,
        slug: true,
        topic: true,
        archivedAt: true,
        userMembers: {
          where: { access: CHAT_ROOM_ACCESS.MEMBER },
          select: {
            userId: true,
            access: true,
            user: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!room || !room.slug) {
      throw notFound("Room not found");
    }

    return ok(
      c,
      adminMatchedChannelDetailSchema.parse({
        id: room.id,
        name: room.name,
        slug: room.slug,
        topic: room.topic,
        archivedAt: room.archivedAt,
        participants: room.userMembers.map((member) => ({
          userId: member.userId,
          name: member.user.name,
          email: member.user.email,
          access: CHAT_ROOM_ACCESS.MEMBER,
        })),
      }),
    );
  });
}
