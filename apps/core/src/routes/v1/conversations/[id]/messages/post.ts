import { createRoute, z } from "@hono/zod-openapi";

import { openrouterClient } from "@/clients/openrouter.client";
import { requireConversationCoworkerAccess } from "@/helpers/access-control";
import { conversationMessageToApiContent } from "@/helpers/conversation-message-api-content";
import { notFound } from "@/helpers/error";
import {
  extractMessageText,
  extractPersistableUiParts,
  extractReasoningPartsFromMessage,
} from "@/helpers/message-content";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { forbidOrchestratorActor, requireUserContext } from "@/middleware/auth";
import {
  conversationMessageSchema,
  createConversationMessageRequestSchema,
} from "@/schemas/conversation-message.schema";

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
            schema: createConversationMessageRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        conversationMessageSchema,
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
    forbidOrchestratorActor(
      c.var.authContext,
      "Orchestrator cannot access marketplace conversations",
    );
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const messagePayload = { content: body.content };
    const contentText = extractMessageText(messagePayload);
    const uiParts = extractPersistableUiParts(messagePayload);
    const reasoningParts = extractReasoningPartsFromMessage(messagePayload);
    const contentType = uiParts[0]?.type ?? null;
    const metadata =
      reasoningParts.length > 0 || uiParts.length > 0
        ? {
            ...(reasoningParts.length > 0 ? { reasoning: reasoningParts } : {}),
            ...(uiParts.length > 0
              ? { ui_message_v1: { parts: uiParts } }
              : {}),
          }
        : undefined;

    const { item, shouldGenerateTitle, conversationId } =
      await prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.findFirst({
          where: {
            id,
            userId: userContext.userId,
            archivedAt: null,
          },
          include: {
            _count: { select: { messages: true } },
          },
        });

        if (!conversation) {
          throw notFound("Conversation not found");
        }

        // Per-resource delegation check: a delegated coworker may only post to a
        // conversation bound to it (no-op for real user sessions).
        await requireConversationCoworkerAccess(
          c.var.authContext,
          conversation.metadata,
          tx,
        );

        const item = await tx.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            role: body.role,
            contentType,
            contentText,
            metadata,
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

    const content = conversationMessageToApiContent({
      contentType: item.contentType,
      contentText: item.contentText,
      metadata: item.metadata,
    });

    const response = {
      id: item.id,
      role: item.role as "user" | "assistant" | "system",
      content,
      createdAt: Math.floor(item.createdAt.getTime() / 1000),
    };

    return created(c, conversationMessageSchema.parse(response));
  });
}
