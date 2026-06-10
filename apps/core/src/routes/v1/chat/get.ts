import { createRoute } from "@hono/zod-openapi";
import { validateUIMessages } from "ai";

import { LIMITS } from "@/config/constants";
import { requireConversationCoworkerAccess } from "@/helpers/access-control";
import { conversationMessagesToUiMessages } from "@/helpers/conversation-messages-to-ui-messages";
import { badRequest, internalServerError, notFound } from "@/helpers/error";
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
import { requireUserContext } from "@/middleware/auth";
import {
  getChatUiMessagesQuerySchema,
  getChatUiMessagesResponseDataSchema,
} from "@/schemas/chat-ui-message.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description:
    "Load persisted messages as AI SDK UIMessage[] for the chat UI (same source as POST /chat persistence).",
  tags: ["Chat"],
  request: {
    query: getChatUiMessagesQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      getChatUiMessagesResponseDataSchema,
      "UIMessages for the conversation (standard data + meta envelope; messages in data.messages)",
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
    404: jsonErrorResponse("Conversation not found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(withGlobalHeaderParameters(route), async (c) => {
    try {
      const userContext = requireUserContext(c.var.authContext);
      const query = c.req.valid("query");
      const { conversationId } = query;

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          userId: userContext.userId,
          archivedAt: null,
        },
        select: { id: true, metadata: true },
      });

      if (!conversation) {
        throw notFound("Conversation not found");
      }

      // Per-resource delegation check: a delegated coworker may only read a
      // conversation bound to it (no-op for real user sessions).
      await requireConversationCoworkerAccess(
        c.var.authContext,
        conversation.metadata,
      );

      const limit = Math.min(
        query.limit ?? LIMITS.CHAT_UI_MESSAGES_DEFAULT_LIMIT,
        LIMITS.CHAT_UI_MESSAGES_MAX_LIMIT,
      );

      const { cursor, take, skip } = parseCursorPagination({
        cursor: query.cursor,
        limit,
      });
      const takePlusOne = take + 1;

      const where = { conversationId };

      const [items, count] = await Promise.all([
        prisma.conversationMessage.findMany({
          where,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          select: { id: true, role: true, contentText: true, metadata: true },
        }),
        prisma.conversationMessage.count({ where }),
      ]);

      const hasMore = items.length === takePlusOne;
      const pagedItems = items.slice(0, take);

      const messages = conversationMessagesToUiMessages(pagedItems);
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

      const paginationMeta = createPaginationMeta(
        pagedItems,
        count,
        take,
        hasMore,
        cursor,
      );

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
        `Failed to load chat UI messages: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
