import { createRoute, z } from "@hono/zod-openapi";
import { conversationRepository } from "@sokosumi/database/repositories";

import { internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { conversationSchema } from "@/schemas/conversation.schema";

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Get a specific conversation by internal ID",
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
  },
  responses: {
    200: jsonSuccessResponse(
      conversationSchema,
      "Conversation retrieved successfully",
      {
        data: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          userId: "550e8400-e29b-41d4-a716-446655440000",
          title: "Chat with Hannah",
          metadata: { coworker: "Hannah" },
          createdAt: "2025-01-21T12:00:00.000Z",
          updatedAt: "2025-01-21T12:00:00.000Z",
        },
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

      // Database is the source of truth - fetch conversation directly from DB
      const conversation = await conversationRepository.getConversationById(
        id,
        authContext.userId,
        prisma,
      );

      if (!conversation) {
        throw notFound("Conversation not found");
      }

      // Map to response schema (excludes internal conversation identifier)
      const response = {
        id: conversation.id,
        userId: conversation.userId,
        title: conversation.title,
        metadata:
          (conversation.metadata as Record<string, unknown> | null) || null,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      };

      return ok(c, response);
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
        `Failed to retrieve conversation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
