import { createRoute, z } from "@hono/zod-openapi";

import { openrouterClient } from "@/clients/openrouter.client";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  conversationItemSchema,
  createConversationItemRequestSchema,
} from "@/schemas/conversation-item.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/messages",
    description: "Add a message to a conversation",
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
        "Conversation message created successfully",
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
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    let contentText: string;
    let contentType: string | null = null;

    if (typeof body.content === "string") {
      contentText = body.content;
    } else if (Array.isArray(body.content) && body.content.length > 0) {
      contentText =
        body.content
          .map((item) => item.text || "")
          .filter(Boolean)
          .join("") || "";
      contentType = body.content[0]?.type || null;
    } else {
      contentText = "";
    }

    const { item, shouldGenerateTitle, conversationId } =
      await prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.findFirst({
          where: {
            id,
            userId: authContext.userId,
            archivedAt: null,
          },
          include: {
            _count: { select: { messages: true } },
          },
        });

        if (!conversation) {
          throw notFound("Conversation not found");
        }

        const item = await tx.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            role: body.role,
            contentType,
            contentText,
          },
        });

        const isFirstItem = conversation._count.messages === 0;
        const shouldGenerateTitle =
          isFirstItem && body.role === "user" && contentText.trim().length > 0;

        return { item, shouldGenerateTitle, conversationId: conversation.id };
      });

    if (shouldGenerateTitle) {
      openrouterClient.generateChatTitle(contentText).then((generatedTitle) => {
        if (generatedTitle) {
          prisma.conversation
            .update({
              where: { id: conversationId },
              data: { title: generatedTitle },
            })
            .catch(() => {});
        }
      });
    }

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
