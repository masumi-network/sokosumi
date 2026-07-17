import { createRoute, z } from "@hono/zod-openapi";

import { requireConversationCoworkerAccess } from "@/helpers/access-control";
import { internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { forbidOrchestratorActor, requireUserContext } from "@/middleware/auth";
import { conversationSchema } from "@/schemas/conversation.schema";

const archiveConversationRequestSchema = z
  .object({
    archived: z.boolean().openapi({
      description: "Whether to archive the conversation",
      example: true,
    }),
  })
  .openapi("ArchiveConversationRequest");

const route = withGlobalHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}/archive",
    description:
      "Archive or unarchive a conversation mapping (sets archivedAt timestamp, can be recovered)",
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
      body: {
        content: {
          "application/json": {
            schema: archiveConversationRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        conversationSchema,
        "Conversation archived successfully",
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
      forbidOrchestratorActor(
        c.var.authContext,
        "Orchestrator cannot access marketplace conversations",
      );
      const userContext = requireUserContext(c.var.authContext);
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");

      // Database is the source of truth - validate ownership and archive in DB
      const updatedConversation = await prisma.$transaction(async (tx) => {
        // Include archived conversations so we can archive/unarchive them
        const existing = await tx.conversation.findFirst({
          where: { id, userId: userContext.userId },
        });

        if (!existing) {
          throw notFound("Conversation not found");
        }

        // Per-resource delegation check: a delegated coworker may only
        // archive a conversation bound to it (no-op for real user sessions).
        await requireConversationCoworkerAccess(
          c.var.authContext,
          existing.metadata,
          tx,
        );

        // Archive or unarchive conversation in database
        const updateData = body.archived
          ? { archivedAt: new Date() }
          : { archivedAt: null };

        return tx.conversation.update({
          where: { id },
          data: updateData,
        });
      });

      // Map to response schema (excludes internal conversation identifier)
      const response = {
        id: updatedConversation.id,
        userId: updatedConversation.userId,
        title: updatedConversation.title,
        metadata:
          (updatedConversation.metadata as Record<string, unknown> | null) ||
          null,
        createdAt: updatedConversation.createdAt,
        updatedAt: updatedConversation.updatedAt,
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
        `Failed to archive conversation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
