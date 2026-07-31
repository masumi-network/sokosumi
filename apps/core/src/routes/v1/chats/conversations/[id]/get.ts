import { createRoute, z } from "@hono/zod-openapi";

import { requireConversationCoworkerAccess } from "@/helpers/access-control";
import { internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { conversationSchema } from "@/schemas/conversation.schema";

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}",
    description: "Get a specific conversation by internal ID",
    tags: ["Conversations"],
    deprecated: true,
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
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Conversation not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const userContext = requireOwnerUserContext(c.var.authContext);
      const { id } = c.req.valid("param");

      // Database is the source of truth - fetch conversation directly from DB
      const conversation = await prisma.$transaction(async (tx) => {
        const found = await tx.conversation.findFirst({
          where: {
            id,
            userId: userContext.userId,
            archivedAt: null,
          },
        });

        if (!found) {
          throw notFound("Conversation not found");
        }

        // Per-resource delegation check: a delegated coworker may only read a
        // conversation bound to it (no-op for real user sessions).
        await requireConversationCoworkerAccess(
          c.var.authContext,
          found.metadata,
          tx,
        );

        return found;
      });

      // Map to response schema (excludes internal conversation identifier)
      const response = {
        id: conversation.id,
        userId: conversation.userId,
        title: conversation.title,
        metadata:
          (conversation.metadata as Record<string, unknown> | null) || null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      };

      return ok(c, conversationSchema.parse(response));
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
