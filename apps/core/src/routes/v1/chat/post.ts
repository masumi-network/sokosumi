import { createRoute, z } from "@hono/zod-openapi";
import { convertToModelMessages, streamText, validateUIMessages } from "ai";

import { openrouterClient } from "@/clients/openrouter.client";
import { requireCoworkerChatCapability } from "@/helpers/access-control";
import { conversationItemsToUiMessages } from "@/helpers/conversation-items-to-ui-messages";
import {
  badRequest,
  internalServerError,
  notFound,
  serviceUnavailable,
} from "@/helpers/error";
import {
  extractMessageText,
  formatMessageContentForConversation,
} from "@/helpers/message-content";
import { jsonErrorResponse } from "@/helpers/openapi";
import { persistAssistantFromAiSdk } from "@/helpers/persist-assistant-from-ai-sdk";
import {
  clearPendingAndSetPrevious,
  persistPendingResponseId,
} from "@/helpers/persist-pending-response-id";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  getOpenRouterChatApiKeyForProvider,
  getSokosumiProvider,
} from "@/lib/sokosumi-ai-provider";
import { requireUserAuthContext } from "@/middleware/auth";

import { aiSdkChatRequestSchema } from "@/schemas/chat-request.schema.js";

import { mapChatRequestToUiMessages } from "./map-chat-request-to-ui-messages.js";

const route = createRoute({
  method: "post",
  path: "/",
  description:
    "Stream chat via Vercel AI SDK (`@sokosumi/ai-provider`) to OpenRouter or a coworker Responses endpoint.",
  tags: ["Chat"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: aiSdkChatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Streaming UI message response (AI SDK)",
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
    503: jsonErrorResponse("Service Unavailable"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(withGlobalHeaderParameters(route), async (c) => {
    try {
      const authContext = requireUserAuthContext(c.var.authContext);

      const {
        messages,
        message: singleMessage,
        conversationId,
        model,
        previousResponseId: bodyPreviousResponseId,
        trigger,
      } = c.req.valid("json");

      const useServerMergedHistory =
        Boolean(conversationId) &&
        singleMessage !== undefined &&
        trigger === "submit-message";

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

      const incomingLast =
        useServerMergedHistory && singleMessage
          ? singleMessage
          : Array.isArray(messages) && messages.length > 0
            ? messages[messages.length - 1]!
            : null;

      const lastUserMessageText =
        incomingLast &&
        (incomingLast.role === "user" || incomingLast.role === "system")
          ? (() => {
              const lastMessage = incomingLast;
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
      const coworkerSlug = metadata?.coworker_slug as string | undefined;
      const coworkerId = metadata?.coworker_id as string | undefined;
      const previousResponseIdFromMeta = metadata?.previous_response_id as
        | string
        | undefined;

      const trimmedBodyPrevious = bodyPreviousResponseId?.trim();
      const previousResponseId =
        trimmedBodyPrevious && trimmedBodyPrevious.length > 0
          ? trimmedBodyPrevious
          : typeof previousResponseIdFromMeta === "string" &&
              previousResponseIdFromMeta.trim().length > 0
            ? previousResponseIdFromMeta.trim()
            : null;

      let coworker: {
        id: string;
        slug: string;
        baseURL: string | null;
      } | null = null;

      if (coworkerSlug || coworkerId) {
        const coworkerIdentity = await prisma.coworker.findFirst({
          where: {
            archivedAt: null,
            OR: [
              ...(coworkerSlug ? [{ slug: coworkerSlug }] : []),
              ...(coworkerId ? [{ id: coworkerId }] : []),
            ],
          },
          select: { id: true },
        });

        if (!coworkerIdentity) {
          throw notFound("Coworker not found");
        }

        coworker = await requireCoworkerChatCapability(coworkerIdentity.id);
      }

      const useCoworker = Boolean(internalConversationId) && Boolean(coworker);

      if (useCoworker) {
        if (lastUserMessageText === null || lastUserMessageText.trim() === "") {
          throw badRequest(
            "Coworker chat requires a user or system message to respond to; send at least one message with text.",
          );
        }
        if (!coworker?.baseURL?.trim()) {
          throw serviceUnavailable(
            "Coworker chat is not available: no Responses API URL configured for this coworker.",
          );
        }
      }

      if (!useCoworker) {
        const chatKey = getOpenRouterChatApiKeyForProvider();
        if (!chatKey.trim()) {
          throw serviceUnavailable("OpenRouter chat API key not configured");
        }
      }

      let uiMessages;
      if (
        useServerMergedHistory &&
        internalConversationId &&
        singleMessage !== undefined
      ) {
        const itemsBeforeUserTurn = await prisma.conversationItem.findMany({
          where: { conversationId: internalConversationId },
          orderBy: { createdAt: "asc" },
          take: 200,
          select: { id: true, role: true, contentText: true },
        });
        const historyUi = conversationItemsToUiMessages(itemsBeforeUserTurn);
        const tailUi = mapChatRequestToUiMessages([singleMessage]);
        uiMessages = [...historyUi, ...tailUi];
      } else {
        uiMessages = mapChatRequestToUiMessages(messages!);
      }

      try {
        await validateUIMessages({ messages: uiMessages });
      } catch (error) {
        throw badRequest(
          error instanceof Error
            ? error.message
            : "Invalid chat messages for AI SDK.",
        );
      }

      if (internalConversationId && incomingLast) {
        const conversationIdForPersistedTurn = internalConversationId;
        const lastMessage = incomingLast;
        if (lastMessage.role === "user" || lastMessage.role === "system") {
          const extractedText = lastUserMessageText ?? "";
          const formattedContent =
            formatMessageContentForConversation(extractedText);

          const convWithCount = await prisma.conversation.findFirst({
            where: {
              id: conversationIdForPersistedTurn,
              userId: authContext.userId,
              archivedAt: null,
            },
            select: { _count: { select: { items: true } } },
          });
          const itemCountBefore = convWithCount?._count.items ?? 0;
          const isFirstUserMessage =
            itemCountBefore === 0 &&
            lastMessage.role === "user" &&
            extractedText.trim().length > 0;

          await prisma.conversationItem.create({
            data: {
              conversationId: conversationIdForPersistedTurn,
              role: lastMessage.role,
              contentType: formattedContent[0]?.type || null,
              contentText: extractedText,
            },
          });
          if (isFirstUserMessage) {
            void openrouterClient
              .generateChatTitle(extractedText)
              .then((generatedTitle) => {
                if (generatedTitle) {
                  return prisma.conversation.update({
                    where: { id: conversationIdForPersistedTurn },
                    data: { title: generatedTitle },
                  });
                }
              })
              .catch((err) => {
                console.error("Failed to generate/update title:", err);
              });
          }
        }
      }

      const modelMessages = await convertToModelMessages(
        uiMessages.map(({ id: _id, ...rest }) => rest),
      );

      const responsesApiResponseIdRef: { current: string | null } = {
        current: null,
      };

      let onInvalidPreviousResponseId: (() => Promise<void>) | undefined;
      if (useCoworker && internalConversationId) {
        const conversationIdForInvalidChain = internalConversationId;
        onInvalidPreviousResponseId = async () => {
          try {
            const conv = await prisma.conversation.findFirst({
              where: {
                id: conversationIdForInvalidChain,
                userId: authContext.userId,
              },
              select: { metadata: true },
            });
            const currentMeta =
              (conv?.metadata as Record<string, unknown>) ?? {};
            const { previous_response_id: _removed, ...metaWithoutPrevious } =
              currentMeta as Record<string, unknown>;
            await prisma.conversation.update({
              where: { id: conversationIdForInvalidChain },
              data: { metadata: metaWithoutPrevious },
            });
          } catch (error) {
            console.error(
              "Failed to clear previous_response_id from conversation after invalid chain (POST /chat):",
              error,
            );
          }
        };
      }

      const sokosumiProviderOptions = {
        mode: useCoworker ? ("coworker" as const) : ("openrouter" as const),
        coworkerBaseUrl: coworker?.baseURL ?? null,
        coworkerSlug: coworker?.slug ?? null,
        sokosumiUserId: authContext.userId,
        sokosumiOrganizationId: authContext.organizationId ?? null,
        previousResponseId: useCoworker ? previousResponseId : null,
        onResponseStarted: (responseId: string) => {
          responsesApiResponseIdRef.current = responseId;
          if (!internalConversationId || !coworker) {
            return;
          }
          void persistPendingResponseId({
            conversationId: internalConversationId,
            userId: authContext.userId,
            responseId,
            coworkerSlug: coworker.slug,
            coworkerId: coworker.id,
          }).catch((error) => {
            console.error("Failed to persist pending response id:", error);
          });
        },
        onResponseCompleted: async (responseId: string) => {
          if (!internalConversationId) {
            return;
          }
          try {
            await clearPendingAndSetPrevious({
              conversationId: internalConversationId,
              userId: authContext.userId,
              responseId,
            });
          } catch (error) {
            console.error(
              "Failed to clear pending and set previous response id:",
              error,
            );
          }
        },
        onInvalidPreviousResponseId,
      };

      const result = streamText({
        model: getSokosumiProvider()(selectedModel),
        messages: modelMessages,
        maxRetries: 0,
        providerOptions: {
          sokosumi: sokosumiProviderOptions,
        } as unknown as NonNullable<
          Parameters<typeof streamText>[0]["providerOptions"]
        >,
        onFinish: async ({ text }) => {
          if (!internalConversationId) {
            return;
          }
          try {
            await persistAssistantFromAiSdk({
              conversationId: internalConversationId,
              userId: authContext.userId,
              text,
              responsesApiResponseId: responsesApiResponseIdRef.current,
            });
          } catch (error) {
            console.error(
              "Failed to persist assistant message (POST /chat):",
              error,
            );
          }
        },
      });

      return result.toUIMessageStreamResponse({
        originalMessages: uiMessages,
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...(internalConversationId
            ? { "x-sokosumi-conversation-id": internalConversationId }
            : {}),
        },
      });
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
        `Failed to stream chat response (POST /chat): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
