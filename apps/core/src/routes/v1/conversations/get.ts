import { createRoute } from "@hono/zod-openapi";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { conversationListResponseSchema } from "@/schemas/conversation.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description: "List all conversations for the authenticated user",
  tags: ["Conversations"],
  responses: {
    200: jsonSuccessResponse(
      conversationListResponseSchema,
      "List of user's conversations",
      {
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440000",
            userId: "550e8400-e29b-41d4-a716-446655440000",
            title: "Chat with Hannah",
            metadata: { coworker: "Hannah" },
            createdAt: "2025-01-21T12:00:00.000Z",
            updatedAt: "2025-01-21T12:00:00.000Z",
          },
        ],
        meta: {
          timestamp: "2025-01-21T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const { authContext } = c.var;

      // Database is the source of truth - fetch conversations directly from DB
      const conversations = await prisma.$transaction(async (tx) => {
        return tx.conversation.findMany({
          where: {
            userId: authContext.userId,
            archivedAt: null,
          },
          orderBy: { updatedAt: "desc" },
        });
      });

      // Map database conversations to response format
      const response = conversations.map((conv) => ({
        id: conv.id,
        userId: conv.userId,
        title: conv.title,
        metadata: (conv.metadata as Record<string, unknown> | null) || null,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
      }));

      return ok(c, conversationListResponseSchema.parse(response));
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
        `Failed to retrieve conversations: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
