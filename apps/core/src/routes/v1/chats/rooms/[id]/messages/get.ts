import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { assertChatMessageReadBudget } from "@/helpers/chat-message-read-budget";
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
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";
import {
  cursorPaginationMetaSchema,
  cursorPaginationQuerySchema,
} from "@/schemas/pagination.schema";
import { dispatchChatRoomMention } from "@/services/chat-room-coworker-dispatch.service";
import { listStaleSentChatRoomMentionIds } from "@/services/chat-room-mention-state";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserMembership,
} from "../../helpers";
import {
  aroundWindowPaginationMeta,
  listChatRoomMessagesAround,
  listChatRoomMessagesFrom,
} from "../../message-windows";
import {
  getChatRoomFirstUnreadMessage,
  getChatRoomThreadAggregates,
} from "../../room-unread";

/** Read messages kept above the first unread message, for context. */
const UNREAD_WINDOW_ABOVE = 3;
/** Messages from the first unread message downward. */
const UNREAD_WINDOW_FROM_FIRST = 30;

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
  // Message cursors are message UUIDs, not the shared schema's CUID example.
  cursor: z
    .string()
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      description:
        "Cursor for pagination (ID of the last message from previous page)",
      example: "550e8400-e29b-41d4-a716-446655440002",
    }),
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
  openAtUnread: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      param: { name: "openAtUnread", in: "query" },
      description: `Open the room at the viewer's Unread divider. When the first unread message is on the newest page, returns that page; otherwise a reading-order window of ${UNREAD_WINDOW_ABOVE} read messages above it and up to ${UNREAD_WINDOW_FROM_FIRST} from it, with the usual older-page cursor. Cannot be combined with q, cursor or around.`,
      example: "true",
    }),
});

// A flat copy, not `.extend`: extending the named schema emits `allOf`, which
// Apple's generator turns into nested `value1`/`value2` pagination fields.
const paginationMetaSchema = z
  .object({
    ...cursorPaginationMetaSchema.shape,
    firstUnreadMessageId: z.string().uuid().nullable().optional().openapi({
      description:
        "The top-level message the viewer's Unread divider sits above, or null when the room has no Room unread. Present on every response without cursor or q.",
      example: "550e8400-e29b-41d4-a716-446655440001",
    }),
  })
  .openapi("ChatRoomMessagesPaginationMetadata");

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/messages",
    description:
      "Get messages for an organization chat room. Prefer Ably realtime updates for new messages; use HTTP for history and bounded fallback recovery.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      query: querySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatRoomMessageSchema),
        "Room messages retrieved",
        undefined,
        paginationMetaSchema,
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      429: jsonErrorResponse("Chat history read budget exceeded"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

/**
 * The viewer's unread reply count per thread parent in this room. One gated
 * query per request rather than a per-message N+1. It reads every unread
 * thread in the room, not only this page's parents: that set is small, and
 * the aggregates are already Participant- and mute-gated, so this cannot
 * disagree with the room's thread unread number.
 */
/** A first page's metadata naming the Unread divider (null: no Room unread). */
function withUnreadDivider<Meta extends object>(
  meta: Meta,
  firstUnread: { id: string } | null,
): Meta & { firstUnreadMessageId: string | null } {
  return { ...meta, firstUnreadMessageId: firstUnread?.id ?? null };
}

async function getUnreadReplyCountByParent(
  roomId: string,
  userId: string,
  messages: ReadonlyArray<{ _count: { replies: number } }>,
): Promise<Map<string, number>> {
  // Most pages hold no thread parent, and then nothing can be unread.
  if (!messages.some((message) => message._count.replies > 0)) {
    return new Map();
  }
  const aggregates = await getChatRoomThreadAggregates(roomId, userId, prisma, {
    unreadOnly: true,
  });
  return new Map(
    aggregates.map((aggregate) => [
      aggregate.parentMessageId,
      aggregate.unreadReplyCount,
    ]),
  );
}

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
    const openAtUnread = queryParams.openAtUnread === "true";
    if (openAtUnread && (searchQuery || cursor || aroundId)) {
      throw unprocessableEntity(
        "openAtUnread cannot be combined with q, cursor or around",
      );
    }
    // Every first page names the Unread divider, so an explicit-target open
    // still knows where it belongs; older pages and search hits do not.
    const placesDivider = !searchQuery && !cursor;

    await requireChatRoomUserMembership(id, userContext.userId, prisma);
    // Shared per-user budget across rooms and credentials (SOK-1060). Runs
    // after authorization so 401/403/404 keep their status, before the reads
    // so throttled requests cost no database load.
    await assertChatMessageReadBudget(userContext.userId);

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
      const [{ messages, hasMoreOlder, count }, firstUnread] =
        await Promise.all([
          listChatRoomMessagesAround({
            db: prisma,
            scope: { roomId: id, parentMessageId: null },
            center,
            take,
          }),
          getChatRoomFirstUnreadMessage(id, userContext.userId, prisma),
        ]);
      const paginationMeta = withUnreadDivider(
        aroundWindowPaginationMeta(messages, take, count, hasMoreOlder),
        firstUnread,
      );
      const unreadByParent = await getUnreadReplyCountByParent(
        id,
        userContext.userId,
        messages,
      );
      return ok(
        c,
        z
          .array(chatRoomMessageSchema)
          .parse(
            messages.map((message) =>
              mapChatRoomMessage(
                message,
                userContext.userId,
                unreadByParent.get(message.id) ?? 0,
              ),
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

    const [messages, count, firstUnread] = await Promise.all([
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
      placesDivider
        ? getChatRoomFirstUnreadMessage(id, userContext.userId, prisma)
        : null,
    ]);

    const hasMore = messages.length === takePlusOne;
    const pageMessages = messages.slice(0, take);
    // Built from the newest-first page, so `nextCursor` is this page's oldest
    // message — the anchor for fetching the next older page.
    let paginationMeta = createPaginationMeta(
      pageMessages,
      count,
      take,
      hasMore,
      cursor,
    );
    // Search keeps newest-first so the hit you want is at the top. The live
    // timeline still reverses into oldest-first reading order.
    let orderedMessages = searchQuery
      ? pageMessages
      : [...pageMessages].reverse();

    if (
      openAtUnread &&
      firstUnread &&
      !pageMessages.some((message) => message.id === firstUnread.id)
    ) {
      // The divider is further back than the newest page: open at it instead.
      // Clients join this window to the newest page with a gap row.
      const unreadWindow = await listChatRoomMessagesFrom({
        db: prisma,
        scope: where,
        first: firstUnread,
        above: UNREAD_WINDOW_ABOVE,
        below: UNREAD_WINDOW_FROM_FIRST,
      });
      orderedMessages = unreadWindow.messages;
      paginationMeta = aroundWindowPaginationMeta(
        unreadWindow.messages,
        take,
        count,
        unreadWindow.hasMoreOlder,
      );
    }
    const responseMeta = placesDivider
      ? withUnreadDivider(paginationMeta, firstUnread)
      : paginationMeta;

    // Polls hit this route; kick abandoned `sent` mentions so reclaim can run
    // after a killed waitUntil left them non-terminal. Skip on search — not a
    // live timeline poll.
    if (!searchQuery) {
      const staleMentionIds = await listStaleSentChatRoomMentionIds(id);
      for (const mentionId of staleMentionIds) {
        waitUntil(dispatchChatRoomMention(mentionId));
      }
    }

    // Search is not a live timeline: hits carry no unread reply count.
    const unreadByParent = searchQuery
      ? new Map<string, number>()
      : await getUnreadReplyCountByParent(
          id,
          userContext.userId,
          orderedMessages,
        );

    return ok(
      c,
      z
        .array(chatRoomMessageSchema)
        .parse(
          orderedMessages.map((message) =>
            mapChatRoomMessage(
              message,
              userContext.userId,
              unreadByParent.get(message.id) ?? 0,
            ),
          ),
        ),
      responseMeta,
    );
  });
}
