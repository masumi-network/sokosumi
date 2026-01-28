import { createRoute, z } from "@hono/zod-openapi";
import { conversationRepository } from "@sokosumi/database/repositories";

import { internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}",
    description:
      "Soft delete a conversation mapping (sets deletedAt timestamp, can be recovered)",
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
      204: {
        description: "Conversation deleted successfully",
      },
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Conversation not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    try {
      const { authContext } = c.var;
      const { id } = c.req.valid("param");

      // Database is the source of truth - validate ownership and soft delete in DB
      // Include deleted conversations so we can re-delete already soft-deleted ones
      const conversation = await conversationRepository.getConversationById(
        id,
        authContext.userId,
        prisma,
        true, // includeDeleted = true to allow re-deleting already soft-deleted conversations
      );

      if (!conversation) {
        throw notFound("Conversation not found");
      }

      // Soft delete from database (sets deletedAt timestamp)
      // This will set deletedAt even if it's already set (idempotent operation)
      await conversationRepository.deleteConversation(
        id,
        authContext.userId,
        prisma,
      );

      return empty(c);
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
        `Failed to delete conversation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
