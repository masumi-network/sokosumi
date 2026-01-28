import { createRoute } from "@hono/zod-openapi";
import { conversationRepository } from "@sokosumi/database/repositories";
import { randomUUID } from "crypto";

import { conflict, internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  conversationSchema,
  createConversationRequestSchema,
} from "@/schemas/conversation.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description: "Create a new conversation mapping",
    tags: ["Conversations"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: createConversationRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        conversationSchema,
        "Conversation created successfully",
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
      409: jsonErrorResponse("Conversation already exists"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const { authContext } = c.var;
      const body = c.req.valid("json");

      // Database is the source of truth - create conversation directly in DB
      // Generate a unique ID for the internal conversation identifier
      const openaiId = randomUUID();

      // Check if conversation with this ID already exists (shouldn't happen with UUID, but safety check)
      const existing = await conversationRepository.getConversationByOpenaiId(
        openaiId,
        authContext.userId,
        prisma,
      );

      if (existing) {
        throw conflict("Conversation already exists");
      }

      // Create conversation in database with title and metadata
      const conversationData = {
        openaiId,
        userId: authContext.userId,
        title: body.title,
        metadata: body.metadata
          ? {
              ...body.metadata,
              userId: authContext.userId, // Store userId in metadata for reference
            }
          : { userId: authContext.userId },
      };

      const conversation = await conversationRepository.createConversation(
        conversationData,
        prisma,
      );

      // Map to response schema
      const response = {
        id: conversation.id,
        userId: conversation.userId,
        title: conversation.title,
        metadata:
          (conversation.metadata as Record<string, unknown> | null) || null,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      };

      return created(c, response);
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
        `Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
