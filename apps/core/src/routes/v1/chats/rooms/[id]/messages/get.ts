import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

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
  parentMessageId: z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: "parentMessageId", in: "query" },
      description:
        "When provided, returns replies for this root message. Otherwise returns top-level room messages.",
      example: "550e8400-e29b-41d4-a716-446655440000",
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

    // Avoid interactive transaction on this read-only path — room page loads
    // messages in parallel with room + members (SOKOSUMI-Q9). Membership gate
    // + page query do not need a shared snapshot. Concurrent findMany/count on
    // the default client is fine; Promise.all inside interactive txs is not
    // (#2559).
    await requireChatRoomUserMembership(id, userContext.userId, prisma);
    const where = {
      roomId: id,
      parentMessageId: queryParams.parentMessageId ?? null,
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
    const orderedMessages = [...pageMessages].reverse();

    // Polls hit this route; kick abandoned `sent` mentions so reclaim can run
    // after a killed waitUntil left them non-terminal.
    const staleMentionIds = await listStaleSentChatRoomMentionIds(id);
    for (const mentionId of staleMentionIds) {
      waitUntil(dispatchChatRoomMention(mentionId));
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
