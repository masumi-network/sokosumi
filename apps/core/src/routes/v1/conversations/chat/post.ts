import { createRoute, z } from "@hono/zod-openapi";

import {
  isResponsesApiAgentId,
  streamResponsesApi,
} from "@/clients/coworker-api.client";
import { openrouterClient } from "@/clients/openrouter.client";
import { isResponsesApiConfigured } from "@/config/env";
import { badRequest, internalServerError, notFound } from "@/helpers/error";
import {
  extractMessageText,
  formatMessageContentForConversation,
} from "@/helpers/message-content";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const chatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
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
  app.post("/chat", async (c) => {
    try {
      const authContext = requireUserAuthContext(c.var.authContext);

      const body = await c.req.json();
      const parsedBody = chatRequestSchema.safeParse(body);

      if (!parsedBody.success) {
        throw badRequest(
          `Invalid request: ${parsedBody.error.issues.map((e) => e.message).join(", ")}`,
        );
      }

      const { messages, conversationId, model } = parsedBody.data;

      let internalConversationId: string | null = null;
      let selectedModel: string | null = model ?? null;
      let conversation: Awaited<
        ReturnType<typeof prisma.conversation.findFirst>
      > = null;

      if (conversationId) {
        conversation = await prisma.conversation.findFirst({
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

        if (!selectedModel) {
          const meta = conversation.metadata as Record<string, unknown> | null;
          const modelId = meta?.model_id as string | undefined;
          if (modelId) {
            selectedModel = modelId;
          }
        }
      }

      const modelMessages = messages.map((msg) => {
        let contentText = "";

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
        } else if (typeof msg.content === "string") {
          contentText = msg.content;
        } else if (Array.isArray(msg.content)) {
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

      const lastUserMessageText =
        messages.length > 0
          ? (() => {
              const lastMessage = messages[messages.length - 1];
              if (lastMessage.role !== "user" && lastMessage.role !== "system")
                return null;
              if ("parts" in lastMessage && Array.isArray(lastMessage.parts)) {
                return lastMessage.parts
                  .map((part: { type?: string; text?: string }) =>
                    part.type === "text" && part.text ? part.text : "",
                  )
                  .filter(Boolean)
                  .join("");
              }
              return extractMessageText(lastMessage as Record<string, unknown>);
            })()
          : null;

      const metadata = (conversation?.metadata ?? null) as Record<
        string,
        unknown
      > | null;
      const agentId = (metadata?.coworker_slug ?? metadata?.coworker_id) as
        | string
        | undefined;
      const lastResponsesApiResponseId =
        metadata?.last_responses_api_response_id as string | undefined;

      const useResponsesApi =
        Boolean(internalConversationId) &&
        isResponsesApiAgentId(agentId) &&
        isResponsesApiConfigured();

      // Validate coworker message text BEFORE persisting to avoid inconsistent state
      if (useResponsesApi) {
        if (lastUserMessageText === null || lastUserMessageText.trim() === "") {
          throw badRequest(
            "Coworker chat requires a user or system message to respond to; send at least one message with text.",
          );
        }
      }

      if (internalConversationId && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === "user" || lastMessage.role === "system") {
          const extractedText = lastUserMessageText ?? "";
          const formattedContent =
            formatMessageContentForConversation(extractedText);

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
              console.error("Failed to add message to conversation:", error);
            });
        }
      }

      if (useResponsesApi) {
        const result = await streamResponsesApi(lastUserMessageText, {
          sokosumiUserId: authContext.userId,
          agentId: agentId as "hannah" | "elena",
          previousResponseId: lastResponsesApiResponseId ?? null,
          onResponseCompleted: async (responseId: string) => {
            if (!internalConversationId) return;
            try {
              const conv = await prisma.conversation.findFirst({
                where: {
                  id: internalConversationId,
                  userId: authContext.userId,
                },
                select: { metadata: true },
              });
              const currentMeta =
                (conv?.metadata as Record<string, unknown>) ?? {};
              await prisma.conversation.update({
                where: { id: internalConversationId },
                data: {
                  metadata: {
                    ...currentMeta,
                    last_responses_api_response_id: responseId,
                  },
                },
              });
            } catch (error) {
              console.error(
                "Failed to persist Responses API response id to conversation:",
                error,
              );
            }
          },
        });
        return result;
      }

      const result = await openrouterClient.streamChatResponse(
        modelMessages,
        selectedModel,
      );

      return result;
    } catch (error) {
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
