import { createRoute, z } from "@hono/zod-openapi";

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
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { conversationItemSchema } from "@/schemas/conversation-item.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

const route = createRoute({
  method: "get",
  path: "/{id}/items",
  description: "Get all items (messages) for a conversation (paginated)",
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
      z.array(conversationItemSchema),
      "Conversation items retrieved successfully",
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
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const authContext = requireUserAuthContext(c.var.authContext);
      const { id } = c.req.valid("param");
      const queryParams = c.req.valid("query");

      const { cursor, take, skip } = parseCursorPagination(queryParams);
      const takePlusOne = take + 1;

      // Database is the source of truth - validate ownership and get items
      const { items, count } = await prisma.$transaction(async (tx) => {
        // Validate ownership
        const conversation = await tx.conversation.findFirst({
          where: {
            id,
            userId: authContext.userId,
            archivedAt: null,
          },
        });

        if (!conversation) {
          throw notFound("Conversation not found");
        }

        const where = {
          conversationId: conversation.id,
        };

        const items = await tx.conversationItem.findMany({
          where,
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        const count = await tx.conversationItem.count({ where });

        return { items, count };
      });

      const hasMore = items.length === takePlusOne;
      const pagedItems = items.slice(0, take);

      // Map to response schema - reconstruct content format from normalized columns
      const response = pagedItems.map((item) => {
        const content: string | Array<{ type: string; text: string }> =
          item.contentType && item.contentType !== ""
            ? [{ type: item.contentType, text: item.contentText }]
            : item.contentText;

        return {
          id: item.id,
          role: item.role as "user" | "assistant" | "system",
          content,
          createdAt: Math.floor(item.createdAt.getTime() / 1000),
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
        z.array(conversationItemSchema).parse(response),
        paginationMeta,
      );
    } catch (error) {
      // Re-throw HTTPException as-is, wrap other errors
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        "message" in error
      ) {
        throw error;
      }
      throw internalServerError(
        `Failed to retrieve conversation items: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
