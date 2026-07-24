import { createRoute, z } from "@hono/zod-openapi";

import { requireConversationCoworkerAccess } from "@/helpers/access-control";
import {
  conversationMessageToApiContent,
  imageGenerationFromMessageMetadata,
  thoughtTimingFromMessageMetadata,
} from "@/helpers/conversation-message-api-content";
import { internalServerError, notFound } from "@/helpers/error";
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
import { requireUserContext } from "@/middleware/auth";
import { conversationMessageSchema } from "@/schemas/conversation-message.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/messages",
    description: "Get messages for a conversation (paginated)",
    tags: ["Conversations"],
    request: {
      params: z.object({
        id: z
          .string()
          .uuid()
          .openapi({
            param: {
              name: "id",
              in: "path",
            },
            description: "Internal database ID",
            example: "550e8400-e29b-41d4-a716-446655440000",
          }),
      }),
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(conversationMessageSchema),
        "Conversation messages retrieved successfully",
        {
          data: [
            {
              id: "550e8400-e29b-41d4-a716-446655440000",
              role: "user",
              content: "Hello!",
              createdAt: 1706284800,
            },
          ],
          meta: {
            timestamp: "2025-01-21T12:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
            pagination: {
              cursor: null,
              limit: 20,
              total: 100,
              nextCursor: "550e8400-e29b-41d4-a716-446655440001",
            },
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Conversation not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const userContext = requireUserContext(c.var.authContext);
      const { id } = c.req.valid("param");
      const queryParams = c.req.valid("query");

      const { cursor, take, skip } = parseCursorPagination(queryParams);
      const takePlusOne = take + 1;

      const { items, count } = await prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.findFirst({
          where: {
            id,
            userId: userContext.userId,
            archivedAt: null,
          },
        });

        if (!conversation) {
          throw notFound("Conversation not found");
        }

        // Per-resource delegation check: a delegated coworker may only read a
        // conversation bound to it (no-op for user sessions / orch+context).
        await requireConversationCoworkerAccess(
          c.var.authContext,
          conversation.metadata,
          tx,
        );

        const where = {
          conversationId: conversation.id,
        };

        const items = await tx.conversationMessage.findMany({
          where,
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        const count = await tx.conversationMessage.count({ where });

        return { items, count };
      });

      const hasMore = items.length === takePlusOne;
      const pagedItems = items.slice(0, take);

      const response = pagedItems.map((item) => {
        const content = conversationMessageToApiContent({
          contentType: item.contentType,
          contentText: item.contentText,
          metadata: item.metadata,
        });
        const thoughtTiming = thoughtTimingFromMessageMetadata(item.metadata);
        const isImageGeneration =
          item.role === "user" &&
          imageGenerationFromMessageMetadata(item.metadata);
        const metadata = isImageGeneration
          ? { imageGeneration: true }
          : undefined;

        return {
          id: item.id,
          role: item.role as "user" | "assistant" | "system",
          content,
          createdAt: Math.floor(item.createdAt.getTime() / 1000),
          ...(thoughtTiming != null ? { thoughtTiming } : {}),
          ...(metadata != null ? { metadata } : {}),
        };
      });

      const paginationMeta = createPaginationMeta(
        pagedItems,
        count,
        take,
        hasMore,
        cursor,
      );

      return ok(
        c,
        z.array(conversationMessageSchema).parse(response),
        paginationMeta,
      );
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
        `Failed to retrieve conversation messages: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
