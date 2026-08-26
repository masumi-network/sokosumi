import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { notFound, unprocessableEntity } from "@/helpers/error";
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
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  dispatchChatRoomMention,
  listStaleSentChatRoomMentionIds,
} from "@/services/chat-room-coworker-dispatch.service";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserMembership,
} from "../../helpers";
import {
  aroundWindowPaginationMeta,
  listChatRoomMessagesAround,
} from "../../message-window-around";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const querySchema = cursorPaginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .openapi({
      param: { name: "q", in: "query" },
      description:
        "Case-insensitive substring match on message content. When set, searches top-level and thread replies and excludes soft-deleted messages.",
      example: "budget",
    }),
  around: z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: "around", in: "query" },
      description:
        "Reading-order window of top-level messages centred on this message, or on its parent if it is a reply. Cannot be combined with q or cursor.",
      example: "550e8400-e29b-41d4-a716-446655440001",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/messages",
    description: "Get messages for an organization chat room.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      query: querySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatRoomMessageSchema),
        "Room messages retrieved",
      ),
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
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1;
    const searchQuery = queryParams.q;
    const aroundId = queryParams.around;
    if (aroundId && (searchQuery || cursor)) {
      throw unprocessableEntity("around cannot be combined with q or cursor");
    }

    // Avoid interactive transaction on this read-only path — room page loads
    // messages in parallel with room + members (SOKOSUMI-Q9). Membership gate
    // + page query do not need a shared snapshot. Concurrent findMany/count on
    // the default client is fine; Promise.all inside interactive txs is not
    // (#2559).
    await requireChatRoomUserMembership(id, userContext.userId, prisma);

    if (aroundId) {
      const target = await prisma.chatRoomMessage.findFirst({
        where: { id: aroundId, roomId: id },
        include: chatRoomMessageInclude,
      });
      if (!target) {
        throw notFound("Message not found");
      }
      let center = target;
      if (target.parentMessageId) {
        const parent = await prisma.chatRoomMessage.findFirst({
          where: {
            id: target.parentMessageId,
            roomId: id,
            parentMessageId: null,
          },
          include: chatRoomMessageInclude,
        });
        if (!parent) {
          throw notFound("Message not found");
        }
        center = parent;
      }
      const { messages, hasMoreOlder, count } =
        await listChatRoomMessagesAround({
          db: prisma,
          scope: { roomId: id, parentMessageId: null },
          center,
          take,
        });
      const paginationMeta = aroundWindowPaginationMeta(
        messages,
        take,
        count,
        hasMoreOlder,
      );
      return ok(
        c,
        z
          .array(chatRoomMessageSchema)
          .parse(
            messages.map((message) =>
              mapChatRoomMessage(message, userContext.userId),
            ),
          ),
        paginationMeta,
      );
    }

    const where = searchQuery
      ? {
          roomId: id,
          deletedAt: null,
          content: { contains: searchQuery, mode: "insensitive" as const },
        }
      : {
          roomId: id,
          parentMessageId: null,
        };

    const [messages, count] = await Promise.all([
      prisma.chatRoomMessage.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        // Newest-first, so an uncursored request (what a room does when it
        // opens) returns the most recent page rather than the first page ever
        // written. Paging with `nextCursor` then walks backwards through
        // history. The page is reversed below so callers still receive it in
        // reading order.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: chatRoomMessageInclude,
      }),
      prisma.chatRoomMessage.count({ where }),
    ]);

    const hasMore = messages.length === takePlusOne;
    const pageMessages = messages.slice(0, take);
    // Built from the newest-first page, so `nextCursor` is this page's oldest
    // message — the anchor for fetching the next older page.
    const paginationMeta = createPaginationMeta(
      pageMessages,
      count,
      take,
      hasMore,
      cursor,
    );
    // Search keeps newest-first so the hit you want is at the top. The live
    // timeline still reverses into oldest-first reading order.
    const orderedMessages = searchQuery
      ? pageMessages
      : [...pageMessages].reverse();

    // Polls hit this route; kick abandoned `sent` mentions so reclaim can run
    // after a killed waitUntil left them non-terminal. Skip on search — not a
    // live timeline poll.
    if (!searchQuery) {
      const staleMentionIds = await listStaleSentChatRoomMentionIds(id);
      for (const mentionId of staleMentionIds) {
        waitUntil(dispatchChatRoomMention(mentionId));
      }
    }

    return ok(
      c,
      z
        .array(chatRoomMessageSchema)
        .parse(
          orderedMessages.map((message) =>
            mapChatRoomMessage(message, userContext.userId),
          ),
        ),
      paginationMeta,
    );
  });
}
