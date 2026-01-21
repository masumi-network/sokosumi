import { createRoute } from "@hono/zod-openapi";
import { conversationRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { conversationListResponseSchema } from "@/schemas/conversation.schema";

const route = withGlobalHeaderParameters(
  createRoute({
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
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const conversations = await conversationRepository.getUserConversations(
      authContext.userId,
      prisma,
    );

    // Map to response schema (excludes openaiId)
    const response = conversations.map((conv) => ({
      id: conv.id,
      userId: conv.userId,
      title: conv.title,
      metadata: conv.metadata as Record<string, unknown> | null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));

    return ok(c, response);
  });
}
