import { createRoute, z } from "@hono/zod-openapi";

import { openrouterClient } from "@/clients/openrouter.client";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  conversationItemSchema,
  createConversationItemRequestSchema,
} from "@/schemas/conversation-item.schema";

const route = createRoute({
  method: "post",
  path: "/{id}/items",
  description: "Add an item to a conversation",
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
          schema: createConversationItemRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      conversationItemSchema,
      "Conversation item created successfully",
      {
        data: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          role: "user",
          content: "Hello!",
          createdAt: 1706284800,
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
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Extract text and type from content
    let contentText: string;
    let contentType: string | null = null;

    if (typeof body.content === "string") {
      contentText = body.content;
    } else if (Array.isArray(body.content) && body.content.length > 0) {
      // Extract text from array format
      contentText =
        body.content
          .map((item) => item.text || "")
          .filter(Boolean)
          .join("") || "";
      // Extract type from first element if available
      contentType = body.content[0]?.type || null;
    } else {
      contentText = "";
    }

    // Database is the source of truth - validate ownership and create item
    const { item, shouldGenerateTitle, conversationId } =
      await prisma.$transaction(async (tx) => {
        // Validate ownership
        const conversation = await tx.conversation.findFirst({
          where: {
            id,
            userId: authContext.userId,
            archivedAt: null,
          },
          include: {
            _count: { select: { items: true } },
          },
        });

        if (!conversation) {
          throw notFound("Conversation not found");
        }

        // Create conversation item in database
        const item = await tx.conversationItem.create({
          data: {
            conversationId: conversation.id,
            role: body.role,
            contentType,
            contentText,
          },
        });

        // Check if we should generate title after transaction commits
        const isFirstItem = conversation._count.items === 0;
        const shouldGenerateTitle =
          isFirstItem && body.role === "user" && contentText.trim().length > 0;

        return { item, shouldGenerateTitle, conversationId: conversation.id };
      });

    // Generate and set conversation title from first user message
    // This is done outside the transaction to avoid timeout issues with the external API call
    if (shouldGenerateTitle) {
      openrouterClient.generateChatTitle(contentText).then((generatedTitle) => {
        if (generatedTitle) {
          prisma.conversation
            .update({
              where: { id: conversationId },
              data: { title: generatedTitle },
            })
            .catch(() => {
              // Title generation is best-effort, don't fail the request
            });
        }
      });
    }

    // Map to response schema - reconstruct content format from normalized columns
    const content: string | Array<{ type: string; text: string }> =
      item.contentType && item.contentType !== ""
        ? [{ type: item.contentType, text: item.contentText }]
        : item.contentText;

    const response = {
      id: item.id,
      role: item.role as "user" | "assistant" | "system",
      content,
      createdAt: Math.floor(item.createdAt.getTime() / 1000),
    };

    return created(c, conversationItemSchema.parse(response));
  });
}
