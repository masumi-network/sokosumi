import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
} from "../../../../../../chats/rooms/helpers";
import { botParams } from "../../../../helpers.js";

const paramsSchema = botParams.extend({
  roomId: z
    .string()
    .uuid()
    .openapi({ param: { name: "roomId", in: "path" } }),
});

const querySchema = cursorPaginationQuerySchema.extend({
  cursor: z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      description: "Oldest message id of the previous page",
    }),
});

const route = createRoute({
  method: "get",
  path: "/{sokoBotId}/chats/{roomId}/messages",
  operationId: "listAdminSokoBotChatMessages",
  description:
    "Read-only page of a Soko Bot direct chat: the newest page first, each page in reading order. Nothing is marked read and nothing is dispatched.",
  tags: ["Admin"],
  request: { params: paramsSchema, query: querySchema },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(chatRoomMessageSchema),
      "Chat messages",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { sokoBotId, roomId } = c.req.valid("param");
    const { cursor, take, skip } = parseCursorPagination(c.req.valid("query"));
    const [room, bot] = await Promise.all([
      prisma.chatRoom.findFirst({
        where: {
          id: roomId,
          kind: "direct",
          sokoBotMembers: { some: { sokoBotId } },
        },
        select: { id: true },
      }),
      prisma.sokoBot.findUnique({
        where: { id: sokoBotId },
        select: { userId: true },
      }),
    ]);
    if (!room || !bot) throw notFound("Chat not found");
    const where = { roomId, parentMessageId: null };
    const [messages, count] = await Promise.all([
      prisma.chatRoomMessage.findMany({
        where,
        take: take + 1,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: chatRoomMessageInclude,
      }),
      prisma.chatRoomMessage.count({ where }),
    ]);
    const hasMore = messages.length === take + 1;
    const page = messages.slice(0, take);
    // Rendered from the owner's side, so their messages read as "theirs".
    return ok(
      c,
      z
        .array(chatRoomMessageSchema)
        .parse(
          [...page]
            .reverse()
            .map((message) => mapChatRoomMessage(message, bot.userId)),
        ),
      createPaginationMeta(page, count, take, hasMore, cursor),
    );
  });
}
