import { createRoute, z } from "@hono/zod-openapi";
import { validateUIMessages } from "ai";

import { LIMITS } from "@/config/constants";
import { chatRoomMessagesToUiMessages } from "@/helpers/chat-room-messages-to-ui-messages";
import { badRequest, internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
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
import {
  getChatUiMessagesResponseDataSchema,
  getRoomChatUiMessagesQuerySchema,
} from "@/schemas/chat-ui-message.schema";

import { requireChatRoomUserMembership } from "../../helpers";

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
    method: "get",
    path: "/{id}/stream/messages",
    description:
      "Load persisted room messages as AI SDK UIMessage[] for coworker stream UI hydrate. Uncursored requests return the newest page (reading order); nextCursor walks older history.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      query: getRoomChatUiMessagesQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        getChatUiMessagesResponseDataSchema,
        "UIMessages for the room stream (standard data + meta envelope; messages in data.messages)",
        {
          data: {
            messages: [
              {
                id: "550e8400-e29b-41d4-a716-446655440001",
                role: "user",
                parts: [{ type: "text", text: "Hello" }],
              },
            ],
          },
          meta: {
            timestamp: "2025-01-21T12:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
            pagination: {
              cursor: null,
              limit: LIMITS.CHAT_UI_MESSAGES_DEFAULT_LIMIT,
              total: 1,
              nextCursor: null,
            },
          },
        },
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Room not found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const userContext = requireUserAuthContext(c.var.authContext);
      const { id: roomId } = c.req.valid("param");
      const query = c.req.valid("query");

      const limit = Math.min(
        query.limit ?? LIMITS.CHAT_UI_MESSAGES_DEFAULT_LIMIT,
        LIMITS.CHAT_UI_MESSAGES_MAX_LIMIT,
      );

      const { cursor, take, skip } = parseCursorPagination({
        cursor: query.cursor,
        limit,
      });
      const takePlusOne = take + 1;

      const { items, count } = await prisma.$transaction(async (tx) => {
        await requireChatRoomUserMembership(roomId, userContext.userId, tx);

        const where = {
          roomId,
          parentMessageId: null,
        };

        const [items, count] = await Promise.all([
          tx.chatRoomMessage.findMany({
            where,
            // Newest-first page (same as GET /messages): open hydrate is the
            // most recent window, not the first 200 messages ever written.
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: takePlusOne,
            skip,
            cursor: cursor ? { id: cursor } : undefined,
            select: {
              id: true,
              content: true,
              senderUserId: true,
              senderCoworkerId: true,
              metadata: true,
              createdAt: true,
            },
          }),
          tx.chatRoomMessage.count({ where }),
        ]);

        return { items, count };
      });

      const hasMore = items.length === takePlusOne;
      const pagedItems = items.slice(0, take);
      // nextCursor is this page's oldest id (last in newest-first page).
      const paginationMeta = createPaginationMeta(
        pagedItems,
        count,
        take,
        hasMore,
        cursor,
      );
      const orderedItems = [...pagedItems].reverse();

      const messages = chatRoomMessagesToUiMessages(orderedItems);
      try {
        await validateUIMessages({ messages });
      } catch (error) {
        throw badRequest(
          error instanceof Error
            ? error.message
            : "Stored messages failed AI SDK validation.",
        );
      }

      const parsed = getChatUiMessagesResponseDataSchema.parse({ messages });

      return ok(c, parsed, paginationMeta);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        "message" in error
      ) {
        throw error;
      }
      throw internalServerError(
        `Failed to load room stream UI messages: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
