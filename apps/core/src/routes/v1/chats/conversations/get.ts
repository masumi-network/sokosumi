import { createRoute } from "@hono/zod-openapi";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  isCoworkerAuthContext,
  requireCoworkerAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import { conversationListResponseSchema } from "@/schemas/conversation.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List all conversations for the effective user (session user, or orchestrator/coworker with context headers). Delegated coworkers only see conversations bound to their coworker id.",
    tags: ["Conversations"],
    deprecated: true,
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
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const userContext = requireUserContext(c.var.authContext);

      // Database is the source of truth - fetch conversations
      const conversations = await prisma.conversation.findMany({
        where: {
          userId: userContext.userId,
          archivedAt: null,
        },
        orderBy: { updatedAt: "desc" },
      });

      // A delegated coworker may only see conversations assigned to it. Scope
      // by the stable `metadata.coworker_id` binding (no slug resolution here);
      // conversations without that binding are excluded for coworker actors.
      // Orchestrator+context acts as the context user and sees the full user list.
      const authContext = c.var.authContext;
      let visibleConversations = conversations;
      if (isCoworkerAuthContext(authContext)) {
        const { coworkerId } = requireCoworkerAuthContext(authContext);
        visibleConversations = conversations.filter((conv) => {
          const meta = (conv.metadata as Record<string, unknown> | null) ?? {};
          return meta.coworker_id === coworkerId;
        });
      }

      // Map database conversations to response format
      const response = visibleConversations.map((conv) => ({
        id: conv.id,
        userId: conv.userId,
        title: conv.title,
        metadata: (conv.metadata as Record<string, unknown> | null) || null,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
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
