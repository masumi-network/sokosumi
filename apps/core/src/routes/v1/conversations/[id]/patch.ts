import { createRoute, z } from "@hono/zod-openapi";
import { conversationRepository } from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  conversationSchema,
  updateConversationRequestSchema,
} from "@/schemas/conversation.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}",
    description: "Update conversation metadata",
    tags: ["Conversations"],
    request: {
      params: z.object({
        id: z.string().uuid().openapi({
          param: {
            name: "id",
            in: "path",
          },
          description: "Internal database ID (not OpenAI ID)",
          example: "550e8400-e29b-41d4-a716-446655440000",
        }),
      }),
      body: {
        content: {
          "application/json": {
            schema: updateConversationRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        conversationSchema,
        "Conversation updated successfully",
        {
          data: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            userId: "550e8400-e29b-41d4-a716-446655440000",
            title: "Updated chat title",
            metadata: { coworker: "John" },
            createdAt: "2025-01-21T12:00:00.000Z",
            updatedAt: "2025-01-21T12:05:00.000Z",
          },
          meta: {
            timestamp: "2025-01-21T12:05:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Conversation not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // CRITICAL: Validate ownership before update
    const conversation = await conversationRepository.getConversationById(
      id,
      authContext.userId,
      prisma,
    );

    if (!conversation) {
      throw notFound("Conversation not found");
    }

    const updated = await conversationRepository.updateConversation(
      id,
      authContext.userId,
      {
        title: body.title,
        metadata: body.metadata,
      },
      prisma,
    );

    // Map to response schema (excludes openaiId)
    const response = {
      id: updated.id,
      userId: updated.userId,
      title: updated.title,
      metadata: updated.metadata as Record<string, unknown> | null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    return ok(c, response);
  });
}
