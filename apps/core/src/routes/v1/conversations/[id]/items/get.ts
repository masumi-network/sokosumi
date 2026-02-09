import { createRoute, z } from "@hono/zod-openapi";

import { internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { conversationItemSchema } from "@/schemas/conversation-item.schema";

const route = createRoute({
  method: "get",
  path: "/{id}/items",
  description: "Get all items (messages) for a conversation",
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
    query: z.object({
      limit: z.coerce.number().optional().openapi({
        description: "Maximum number of items to return",
      }),
      after: z.string().optional().openapi({
        description: "Cursor for pagination (item ID)",
      }),
    }),
  },
  responses: {
    200: jsonSuccessResponse(
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
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Conversation not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const { authContext } = c.var;
      const { id } = c.req.valid("param");
      const { limit, after } = c.req.valid("query");

      // Database is the source of truth - validate ownership and get items
      const { items } = await prisma.$transaction(async (tx) => {
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

        // Get conversation items from database
        const items = await tx.conversationItem.findMany({
          where: {
            conversationId: conversation.id,
          },
          orderBy: { createdAt: "asc" },
          ...(after
            ? {
                cursor: { id: after },
                skip: 1,
              }
            : {}),
          ...(limit ? { take: limit } : {}),
        });

        return { conversation, items };
      });

      // Map to response schema - reconstruct content format from normalized columns
      const response = items.map((item) => {
        const content: string | Array<{ type: string; text: string }> =
          item.contentType && item.contentType !== ""
            ? [{ type: item.contentType, text: item.contentText }]
            : item.contentText;

        return {
          id: item.id,
          role: item.role as "user" | "assistant",
          content,
          createdAt: Math.floor(item.createdAt.getTime() / 1000),
        };
      });

      return ok(c, z.array(conversationItemSchema).parse(response));
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
