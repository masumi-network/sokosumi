import { createRoute, z } from "@hono/zod-openapi";
import type { SokosumiProviderCallOptions } from "@sokosumi/ai-provider";
import { waitUntil } from "@vercel/functions";
import {
  convertToModelMessages,
  generateId,
  streamText,
  validateUIMessages,
} from "ai";
import { openrouterClient } from "@/clients/openrouter.client";
import { LIMITS } from "@/config/constants";
import { requireCoworkerChatCapability } from "@/helpers/access-control";
import {
  clearActiveUiStreamIdInMetadata,
  setActiveUiStreamIdInMetadata,
} from "@/helpers/active-ui-stream-metadata";
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
  getResumableUiStreamContext,
  isUiStreamResumptionConfigured,
} from "@/lib/resumable-ui-stream-context";
import {
  getOpenRouterChatApiKeyForProvider,
  getSokosumiProvider,
} from "@/lib/sokosumi-ai-provider";
import { requireUserAuthContext } from "@/middleware/auth";
import { aiSdkChatRequestSchema } from "@/schemas/chat-request.schema.js";
import { createCoworkerConversation } from "./coworker-conversation";

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
        const itemsBeforeUserTurn = await prisma.conversationMessage.findMany({
          where: { conversationId: internalConversationId },
          orderBy: { createdAt: "asc" },
          take: LIMITS.CHAT_UI_MESSAGES_MAX_LIMIT,
          select: { id: true, role: true, contentText: true, metadata: true },
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
            select: { _count: { select: { messages: true } } },
          });
          const itemCountBefore = convWithCount?._count.messages ?? 0;
          const isFirstUserMessage =
            itemCountBefore === 0 &&
            lastMessage.role === "user" &&
            extractedText.trim().length > 0;

          await prisma.conversationMessage.create({
            data: {
              conversationId: conversationIdForPersistedTurn,
              role: lastMessage.role,
              contentType: formattedContent[0]?.type || null,
              contentText: extractedText,
            },
          });
          if (isFirstUserMessage) {
            waitUntil(
              (async () => {
                try {
                  const generatedTitle =
                    await openrouterClient.generateChatTitle(extractedText);
                  if (generatedTitle) {
                    await prisma.conversation.update({
                      where: { id: conversationIdForPersistedTurn },
                      data: { title: generatedTitle },
                    });
                  }
                } catch (err) {
                  console.error("Failed to generate/update title:", err);
                }
              })(),
            );
          }
        }
      }

      let providerConversationId = conversation?.providerConversationId ?? null;

      if (
        useCoworker &&
        coworker &&
        internalConversationId &&
        !providerConversationId
      ) {
        const created = await createCoworkerConversation({
          responsesApiBaseUrl: coworker.baseURL!.trim(),
          sokosumiUserId: authContext.userId,
          sokosumiOrganizationId: authContext.organizationId ?? null,
          coworkerSlug: coworker.slug,
          sokosumiConversationId: internalConversationId,
        });
        const updated = await prisma.conversation.updateMany({
          where: {
            id: internalConversationId,
            userId: authContext.userId,
            providerConversationId: null,
          },
          data: { providerConversationId: created.id },
        });
        if (updated.count === 0) {
          const refetched = await prisma.conversation.findFirst({
            where: {
              id: internalConversationId,
              userId: authContext.userId,
            },
            select: { providerConversationId: true },
          });
          providerConversationId = refetched?.providerConversationId ?? null;
        } else {
          providerConversationId = created.id;
        }
      }

      if (useCoworker && !providerConversationId?.trim()) {
        throw serviceUnavailable(
          "Coworker chat could not create or resolve a remote conversation. Try again shortly.",
        );
      }

      const coworkerConversationsMode = Boolean(
        useCoworker && coworker && providerConversationId,
      );

      if (internalConversationId && isUiStreamResumptionConfigured()) {
        try {
          await clearActiveUiStreamIdInMetadata({
            conversationId: internalConversationId,
            userId: authContext.userId,
          });
        } catch (error) {
          console.error(
            "Failed to clear active UI stream id before new chat stream:",
            error,
          );
        }
      }

      const modelMessages = await convertToModelMessages(
        uiMessages.map(({ id: _id, ...rest }) => rest),
      );

      const responsesApiResponseIdRef: { current: string | null } = {
        current: null,
      };

      const thoughtPhaseMs = {
        start: null as number | null,
        end: null as number | null,
        sawReasoningChunk: false,
      };

      let onInvalidProviderConversationId: (() => Promise<void>) | undefined;
      if (useCoworker && internalConversationId) {
        const conversationIdForInvalidProviderConv = internalConversationId;
        onInvalidProviderConversationId = async () => {
          try {
            await prisma.conversation.update({
              where: {
                id: conversationIdForInvalidProviderConv,
                userId: authContext.userId,
              },
              data: { providerConversationId: null },
            });
          } catch (error) {
            console.error(
              "Failed to clear providerConversationId after invalid remote conversation (POST /chat):",
              error,
            );
          }
        };
      }

      const sokosumiProviderOptions: SokosumiProviderCallOptions = {
        mode: useCoworker ? "coworker" : "openrouter",
        coworkerBaseUrl: coworker?.baseURL ?? null,
        coworkerSlug: coworker?.slug ?? null,
        sokosumiUserId: authContext.userId,
        sokosumiOrganizationId: authContext.organizationId ?? null,
        previousResponseId: null,
        providerConversationId: coworkerConversationsMode
          ? providerConversationId
          : null,
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
        onInvalidProviderConversationId,
      };

      const result = streamText({
        model: getSokosumiProvider()(selectedModel),
        messages: modelMessages,
        maxRetries: 0,
        providerOptions: {
          sokosumi: sokosumiProviderOptions,
        } as unknown as Parameters<typeof streamText>[0]["providerOptions"],
        onChunk: ({ chunk }) => {
          if (!useCoworker) {
            return;
          }
          const chunkType = chunk.type as string;
          if (
            chunkType === "reasoning-start" ||
            chunkType === "reasoning-delta"
          ) {
            thoughtPhaseMs.sawReasoningChunk = true;
            thoughtPhaseMs.start = thoughtPhaseMs.start ?? Date.now();
          }
          if (chunkType === "reasoning-end") {
            thoughtPhaseMs.end = Date.now();
          }
          if (
            chunk.type === "text-delta" &&
            thoughtPhaseMs.sawReasoningChunk &&
            thoughtPhaseMs.end == null
          ) {
            thoughtPhaseMs.end = Date.now();
          }
        },
        onFinish: async (finishEvent) => {
          if (!internalConversationId) {
            return;
          }
          try {
            const hasReasoning =
              Array.isArray(finishEvent.reasoning) &&
              finishEvent.reasoning.length > 0;
            if (
              useCoworker &&
              hasReasoning &&
              thoughtPhaseMs.start != null &&
              thoughtPhaseMs.end == null
            ) {
              thoughtPhaseMs.end = Date.now();
            }
            const thoughtTiming =
              useCoworker && hasReasoning && thoughtPhaseMs.start != null
                ? {
                    startedAtMs: thoughtPhaseMs.start,
                    endedAtMs: thoughtPhaseMs.end ?? Date.now(),
                  }
                : undefined;
            await persistAssistantFromAiSdk({
              conversationId: internalConversationId,
              userId: authContext.userId,
              text: finishEvent.text,
              responsesApiResponseId: responsesApiResponseIdRef.current,
              reasoning: useCoworker ? finishEvent.reasoning : undefined,
              thoughtTiming,
            });
          } catch (error) {
            console.error(
              "Failed to persist assistant message (POST /chat):",
              error,
            );
          }
        },
      });

      const enableResumableUiStream =
        Boolean(internalConversationId) && isUiStreamResumptionConfigured();

      return result.toUIMessageStreamResponse({
        originalMessages: uiMessages,
        generateMessageId: generateId,
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...(internalConversationId
            ? { "x-sokosumi-conversation-id": internalConversationId }
            : {}),
        },
        ...(enableResumableUiStream && internalConversationId
          ? {
              consumeSseStream: async ({ stream }) => {
                const streamId = generateId();
                const convId = internalConversationId;
                const userId = authContext.userId;
                try {
                  const ctx = getResumableUiStreamContext();
                  await ctx.createNewResumableStream(streamId, () => stream);
                  await setActiveUiStreamIdInMetadata({
                    conversationId: convId,
                    userId,
                    streamId,
                  });
                } catch (error) {
                  console.error(
                    "Failed to register resumable UI message stream:",
                    error,
                  );
                }
              },
              onFinish: async () => {
                try {
                  await clearActiveUiStreamIdInMetadata({
                    conversationId: internalConversationId,
                    userId: authContext.userId,
                  });
                } catch (error) {
                  console.error(
                    "Failed to clear active UI stream id on stream finish:",
                    error,
                  );
                }
              },
            }
          : {}),
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
