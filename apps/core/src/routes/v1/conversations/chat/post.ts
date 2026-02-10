import { createRoute, z } from "@hono/zod-openapi";

import { openrouterClient } from "@/clients/openrouter.client";
import { badRequest, internalServerError, notFound } from "@/helpers/error";
import {
  extractMessageText,
  formatMessageContentForConversation,
} from "@/helpers/message-content";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";

const chatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      // Accept UIMessage format (parts) or CoreMessage format (content)
      parts: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          }),
        )
        .optional(),
      content: z
        .union([
          z.string(),
          z.array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
            }),
          ),
        ])
        .optional(),
      id: z.string().optional(),
    }),
  ),
  conversationId: z.string().uuid().optional(),
  model: z.string().nullable().optional(),
});

const _route = createRoute({
  method: "post",
  path: "/chat",
  description: "Stream chat responses from AI models",
  tags: ["Conversations"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: chatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Streaming chat response",
      content: {
        "text/event-stream": {
          schema: z.string(),
        },
      },
    },
    400: jsonErrorResponse("Invalid request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Conversation not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  // Use regular route handler for streaming (OpenAPI validation interferes with streams)
  // Register route definition separately for OpenAPI documentation
  app.post("/chat", async (c) => {
    try {
      const { authContext } = c.var;

      // Manually parse and validate request body
      const body = await c.req.json();
      const parsedBody = chatRequestSchema.safeParse(body);

      if (!parsedBody.success) {
        throw badRequest(
          `Invalid request: ${parsedBody.error.issues.map((e) => e.message).join(", ")}`,
        );
      }

      const { messages, conversationId, model } = parsedBody.data;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw badRequest("Invalid messages format");
      }

      let internalConversationId: string | null = null;
      let selectedModel: string | null = model || null;

      // If conversationId is provided, validate ownership
      if (conversationId) {
        const conversation = await prisma.conversation.findFirst({
          where: {
            id: conversationId,
            userId: authContext.userId,
            archivedAt: null,
          },
        });

        if (!conversation) {
          throw notFound("Conversation not found");
        }

        internalConversationId = conversation.id;

        // If model is not provided in request body, fetch it from conversation metadata
        if (!selectedModel) {
          const metadata = conversation.metadata as Record<
            string,
            unknown
          > | null;
          const modelId = metadata?.model_id as string | undefined;
          if (modelId) {
            selectedModel = modelId;
          }
        }
      }

      // Transform messages to CoreMessage format for streamText
      // Messages can come in UIMessage format (with parts) or CoreMessage format (with content)
      // streamText accepts CoreMessage format directly (role + content)
      const modelMessages = messages.map((msg) => {
        let contentText = "";

        // Handle UIMessage format (parts)
        if ("parts" in msg && Array.isArray(msg.parts)) {
          contentText = msg.parts
            .map((part: { type?: string; text?: string }) => {
              if (part.type === "text" && part.text) {
                return part.text;
              }
              return "";
            })
            .filter(Boolean)
            .join("");
        }
        // Handle CoreMessage format (content as string)
        else if (typeof msg.content === "string") {
          contentText = msg.content;
        }
        // Handle CoreMessage format (content as array)
        else if (Array.isArray(msg.content)) {
          contentText = (msg.content as Array<{ text?: string }>)
            .map((part) => part?.text || "")
            .filter(Boolean)
            .join("");
        }

        return {
          role: msg.role,
          content: contentText,
        };
      });

      // Add the latest user message to conversation if we have a conversation ID
      if (internalConversationId && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === "user" || lastMessage.role === "system") {
          // Extract text from either parts (UIMessage) or content (CoreMessage)
          let extractedText = "";
          if ("parts" in lastMessage && Array.isArray(lastMessage.parts)) {
            extractedText = lastMessage.parts
              .map((part: { type?: string; text?: string }) => {
                if (part.type === "text" && part.text) {
                  return part.text;
                }
                return "";
              })
              .filter(Boolean)
              .join("");
          } else {
            extractedText = extractMessageText(
              lastMessage as Record<string, unknown>,
            );
          }
          const formattedContent =
            formatMessageContentForConversation(extractedText);

          // Add message to conversation (fire-and-forget)
          prisma.conversationItem
            .create({
              data: {
                conversationId: internalConversationId,
                role: lastMessage.role,
                contentType: formattedContent[0]?.type || null,
                contentText: extractedText,
              },
            })
            .catch((error) => {
              // Log error but don't fail the request
              console.error("Failed to add message to conversation:", error);
            });
        }
      }

      // Stream response from OpenRouter Responses API
      const result = await openrouterClient.streamChatResponse(
        modelMessages,
        selectedModel,
      );

      // Return the streaming response directly
      // Hono supports returning streaming responses directly
      // Using app.post() instead of app.openapi() to avoid response validation issues with streaming
      return result;
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
        `Failed to stream chat response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
