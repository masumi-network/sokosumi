import { createRoute } from "@hono/zod-openapi";
import { conversationRepository } from "@sokosumi/database/repositories";

import { conflict } from "@/helpers/error";
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
    const { authContext } = c.var;
    const body = c.req.valid("json");

    // Check if conversation with this openaiId already exists for this user
    const existing = await conversationRepository.getConversationByOpenaiId(
      body.openaiId,
      authContext.userId,
      prisma,
    );

    if (existing) {
      throw conflict("Conversation already exists");
    }

    const conversation = await conversationRepository.createConversation(
      {
        openaiId: body.openaiId,
        userId: authContext.userId,
        title: body.title,
        metadata: body.metadata,
      },
      prisma,
    );

    // Map to response schema (excludes openaiId)
    const response = {
      id: conversation.id,
      userId: conversation.userId,
      title: conversation.title,
      metadata: conversation.metadata as Record<string, unknown> | null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };

    return created(c, response);
  });
}
