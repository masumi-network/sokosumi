import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import { botParams } from "../../helpers.js";

export const adminSokoBotChatRoomSchema = z
  .object({
    id: z.string(),
    isOwnerRoom: z.boolean(),
    participants: z.array(
      z.object({ id: z.string(), name: z.string().nullable() }),
    ),
    archived: z.boolean(),
    lastActivityAt: z.string(),
  })
  .openapi("AdminSokoBotChatRoom");

const route = createRoute({
  method: "get",
  path: "/{sokoBotId}/chats",
  operationId: "listAdminSokoBotChats",
  description:
    "Direct chats people have with this Soko Bot, for read-only support viewing.",
  tags: ["Admin"],
  request: { params: botParams },
  responses: {
    200: jsonSuccessResponse(
      z.array(adminSokoBotChatRoomSchema),
      "Soko Bot direct chats",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { sokoBotId } = c.req.valid("param");
    const bot = await prisma.sokoBot.findUnique({
      where: { id: sokoBotId },
      select: { userId: true },
    });
    if (!bot) throw notFound("Soko Bot not found");
    const rooms = await prisma.chatRoom.findMany({
      where: { kind: "direct", sokoBotMembers: { some: { sokoBotId } } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        archivedAt: true,
        updatedAt: true,
        userMembers: {
          select: { user: { select: { id: true, name: true } } },
        },
      },
    });
    return ok(
      c,
      z.array(adminSokoBotChatRoomSchema).parse(
        rooms.map((room) => {
          const participants = room.userMembers.map((member) => member.user);
          return {
            id: room.id,
            isOwnerRoom: participants.some((user) => user.id === bot.userId),
            participants,
            archived: room.archivedAt !== null,
            lastActivityAt: room.updatedAt.toISOString(),
          };
        }),
      ),
    );
  });
}
