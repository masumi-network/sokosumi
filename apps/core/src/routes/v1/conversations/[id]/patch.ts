import { createRoute, z } from "@hono/zod-openapi";

import { requireConversationCoworkerAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  isUserAuthContext,
  requireCoworkerAuthContext,
  requireUserContext,
} from "@/middleware/auth";
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
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Conversation not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const authContext = c.var.authContext;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Database is the source of truth - validate ownership and update in DB
    const updatedConversation = await prisma.$transaction(async (tx) => {
      // First verify ownership (exclude deleted conversations)
      const existing = await tx.conversation.findFirst({
        where: { id, userId: userContext.userId, archivedAt: null },
      });

      if (!existing) {
        throw notFound("Conversation not found");
      }

      // Per-resource delegation check: a delegated coworker may only update a
      // conversation bound to it (no-op for real user sessions).
      await requireConversationCoworkerAccess(
        c.var.authContext,
        existing.metadata,
        tx,
      );

      // Build update data - only include fields that were explicitly provided
      const updateData: {
        title?: string;
        metadata?: Record<string, unknown>;
      } = {
        title: body.title,
      };

      // Only update metadata if explicitly provided in the request
      if (body.metadata !== undefined) {
        const existingMetadata =
          (existing.metadata as Record<string, unknown> | null) || {};
        // A delegated coworker may only act on its own conversation (enforced
        // above); re-pin the coworker binding so a metadata update cannot
        // rebind the conversation to another coworker.
        const coworkerBinding = isUserAuthContext(authContext)
          ? {}
          : {
              coworker_id: requireCoworkerAuthContext(authContext).coworkerId,
            };
        updateData.metadata = {
          ...existingMetadata,
          ...body.metadata,
          ...coworkerBinding,
          userId: userContext.userId, // Ensure userId is preserved
        };
      }

      // Update conversation in database
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
  });
}
