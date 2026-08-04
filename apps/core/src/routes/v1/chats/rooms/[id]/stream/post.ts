import { createRoute, z } from "@hono/zod-openapi";
import type { SokosumiProviderCallOptions } from "@sokosumi/ai-provider";
import { waitUntil } from "@vercel/functions";
import {
  convertToModelMessages,
  generateId,
  type ModelMessage,
  streamText,
  type UIMessage,
  validateUIMessages,
} from "ai";

import { requireCoworkerChatCapability } from "@/helpers/access-control";
import {
  clearActiveUiStreamIdForRoom,
  setActiveUiStreamIdForRoom,
} from "@/helpers/active-ui-stream-room-metadata";
import { assertCoworkerBaseUrlIsPublic } from "@/helpers/coworker-base-url";
import {
  clearPendingResponseMirror,
  getPendingResponseMirror,
  renewPendingResponseMirror,
  setPendingResponseMirror,
} from "@/helpers/coworker-pending-response-mirror";
import { pollCoworkerResponseStatus } from "@/helpers/coworker-response-poll";
import {
  acquireStreamLock,
  releaseStreamLock,
  startStreamLockHeartbeat,
} from "@/helpers/coworker-stream-lock";
import {
  badRequest,
  conflict,
  serviceUnavailable,
  unprocessableEntity,
} from "@/helpers/error";
import { extractMessageText } from "@/helpers/message-content";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  persistAssistantToChatRoom,
  persistUserMessageToChatRoom,
} from "@/helpers/persist-assistant-to-chat-room";
import {
  buildRoomStreamThreadModelMessages,
  ensureThreadProviderConversation,
  THREAD_PROVIDER_CONVERSATION_ID_KEY,
} from "@/helpers/room-stream-thread";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  getResumableUiStreamContext,
  isUiStreamResumptionConfigured,
} from "@/lib/resumable-ui-stream-context";
import { getSokosumiProvider } from "@/lib/sokosumi-ai-provider";
import { requireUserAuthContext } from "@/middleware/auth";
import { throwCoworkerRemoteConversationHttpError } from "@/routes/v1/chats/stream/coworker-conversation";
import { mapChatRequestToUiMessages } from "@/routes/v1/chats/stream/map-chat-request-to-ui-messages.js";
import {
  AI_SDK_CHAT_MESSAGES_REQUIREMENT,
  roomStreamRequestSchema,
} from "@/schemas/chat-request.schema.js";

import {
  mergeChatRoomMessageMetadata,
  requireChatRoomUserWriteAccess,
  resolveRoomQuoteSnapshot,
  resolveThreadParentMessageId,
} from "../../helpers";
import { ensureCoworkerProviderConversationForRoom } from "./coworker-provider-conversation";

/**
 * Room-keyed coworker 1:1 stream (MVP).
 *
 * Deferred to follow-up (parity with legacy conversation stream):
 * - Image generation / OpenRouter paths
 * - Web search
 * - Stream path attachments / multimodal uploads
 */

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

async function validateUiMessagesOrBadRequest(
  messages: UIMessage[],
): Promise<void> {
  try {
    await validateUIMessages({ messages });
  } catch (error) {
    throw badRequest(
      error instanceof Error
        ? error.message
        : "Invalid chat messages for AI SDK.",
    );
  }
}

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/stream",
    description:
      "Stream a coworker 1:1 reply into a chat room (AI SDK SSE). Persists to chat_room_message; does not write conversation* rows. Optional parentMessageId scopes the turn as a thread reply under that top-level message. Optional quote snapshots another same-room message into metadata.quote without setting parentMessageId. Requires a direct room with exactly one user member (the caller) and one coworker member.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: roomStreamRequestSchema,
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
      404: jsonErrorResponse("Room not found"),
      409: jsonErrorResponse("Conflict"),
      503: jsonErrorResponse("Service Unavailable"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id: roomId } = c.req.valid("param");
    const {
      messages,
      model,
      parentMessageId: requestedParentMessageId,
      quote: requestedQuote,
    } = c.req.valid("json");

    if (!Array.isArray(messages) || messages.length === 0) {
      throw unprocessableEntity(AI_SDK_CHAT_MESSAGES_REQUIREMENT);
    }

    const room = await prisma.$transaction(async (tx) =>
      requireChatRoomUserWriteAccess(roomId, userContext.userId, tx),
    );

    // Match web `isCoworkerOnlyDirectRoom` and message-POST skip-mention:
    // stream is only for 1:1 human↔coworker directs, never multi-human
    // channels that happen to include a coworker.
    const isCoworkerOnlyDirect =
      room.kind === "direct" &&
      room.coworkerMembers.length === 1 &&
      room.userMembers.length === 1 &&
      room.userMembers[0]?.userId === userContext.userId;
    if (!isCoworkerOnlyDirect) {
      throw badRequest(
        "Room stream requires a 1:1 direct with exactly one AI coworker member. Use message POST for channels and human-only rooms.",
      );
    }

    const { parentMessageId, userMessageMetadata } = await prisma.$transaction(
      async (tx) => {
        const parentMessageId = await resolveThreadParentMessageId(
          tx,
          room.id,
          requestedParentMessageId,
        );
        const quote = await resolveRoomQuoteSnapshot(
          tx,
          room.id,
          requestedQuote?.messageId,
        );
        return {
          parentMessageId,
          userMessageMetadata: mergeChatRoomMessageMetadata(null, quote),
        };
      },
    );

    const roomCoworker = room.coworkerMembers[0]!.coworker;
    const coworker = await requireCoworkerChatCapability(roomCoworker.id);
    if (!coworker.baseURL?.trim()) {
      throw serviceUnavailable(
        "Coworker chat is not available: no Responses API URL configured for this coworker.",
      );
    }

    const uiMessages = mapChatRequestToUiMessages(messages);
    await validateUiMessagesOrBadRequest(uiMessages);

    const lastMessage = messages[messages.length - 1]!;
    const lastUserMessageText =
      lastMessage.role === "user" || lastMessage.role === "system"
        ? (() => {
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
        : "";

    if (
      (lastMessage.role === "user" || lastMessage.role === "system") &&
      !lastUserMessageText.trim()
    ) {
      throw badRequest(
        "Coworker chat requires a user or system message with text to respond to.",
      );
    }

    // Acquire before persist so concurrent POSTs cannot duplicate turns.
    // unavailable = Redis never configured (local) → fail-open with soft dedup.
    // error = Redis configured but broken → fail-closed (no unlocked multi-instance races).
    const streamLock = await acquireStreamLock(room.id);
    if (streamLock.status === "held") {
      throw conflict(
        "A coworker response is already in progress for this room.",
      );
    }
    if (streamLock.status === "error") {
      throw serviceUnavailable(
        "Coworker stream lock is temporarily unavailable. Retry shortly.",
      );
    }
    const streamLockOwnerToken =
      streamLock.status === "acquired" ? streamLock.ownerToken : null;

    const pendingResponseScope = {
      roomId: room.id,
      parentMessageId,
    };

    const stopHeartbeat = streamLockOwnerToken
      ? startStreamLockHeartbeat(room.id, streamLockOwnerToken, {
          onRenew: () => renewPendingResponseMirror(pendingResponseScope),
        })
      : null;

    let releaseOwnedCoworkerStreamLock: (() => Promise<void>) | null =
      async () => {
        stopHeartbeat?.();
        if (streamLockOwnerToken) {
          await releaseStreamLock(room.id, streamLockOwnerToken);
        }
      };

    const finalizeCoworkerStreamLock = () => {
      waitUntil(clearPendingResponseMirror(pendingResponseScope));
      const release = releaseOwnedCoworkerStreamLock;
      if (!release) {
        return;
      }
      releaseOwnedCoworkerStreamLock = null;
      waitUntil(release());
    };

    try {
      const mirroredPending =
        await getPendingResponseMirror(pendingResponseScope);
      if (mirroredPending) {
        const pollResult = await pollCoworkerResponseStatus({
          responsesApiBaseUrl: coworker.baseURL.trim(),
          responseId: mirroredPending,
          userId: userContext.userId,
          organizationId: room.organizationId,
          coworkerSlug: coworker.slug,
        });

        if (pollResult.status === "in_progress") {
          throw conflict(
            "A coworker response is already in progress for this room.",
          );
        }

        await clearPendingResponseMirror(pendingResponseScope);

        if (pollResult.status === "error") {
          throw serviceUnavailable(
            "Coworker chat could not verify an in-flight response. Try again shortly.",
            { reportToSentry: false },
          );
        }
      }

      if (lastMessage.role === "user" || lastMessage.role === "system") {
        const clientMessageId =
          typeof lastMessage.id === "string" ? lastMessage.id : null;
        await persistUserMessageToChatRoom({
          roomId: room.id,
          senderUserId: userContext.userId,
          contentText: lastUserMessageText,
          clientMessageId,
          parentMessageId,
          ...(userMessageMetadata ? { metadata: userMessageMetadata } : {}),
        });
      }

      // Room owns org scope (null = personal). Do not inherit active session org.
      const roomOrganizationId = room.organizationId;

      let providerConversationId: string | null = null;
      if (parentMessageId) {
        try {
          const ensured = await ensureThreadProviderConversation({
            roomId: room.id,
            parentMessageId,
            userId: userContext.userId,
            organizationId: roomOrganizationId,
            coworkerSlug: coworker.slug,
            responsesApiBaseUrl: coworker.baseURL.trim(),
          });
          providerConversationId = ensured.providerConversationId;
        } catch (error) {
          throwCoworkerRemoteConversationHttpError(error);
        }
      } else {
        providerConversationId = room.providerConversationId?.trim() || null;
        if (!providerConversationId) {
          try {
            const ensured = await ensureCoworkerProviderConversationForRoom({
              roomId: room.id,
              userId: userContext.userId,
              organizationId: roomOrganizationId,
              coworkerSlug: coworker.slug,
              responsesApiBaseUrl: coworker.baseURL.trim(),
            });
            providerConversationId = ensured.providerConversationId;
          } catch (error) {
            throwCoworkerRemoteConversationHttpError(error);
          }
        }
      }

      if (!providerConversationId?.trim()) {
        throw serviceUnavailable(
          "Coworker chat could not create or resolve a remote conversation. Try again shortly.",
        );
      }

      const enableResumableUiStream = isUiStreamResumptionConfigured();
      if (enableResumableUiStream) {
        try {
          await clearActiveUiStreamIdForRoom({
            roomId: room.id,
            userId: userContext.userId,
          });
        } catch (error) {
          console.error(
            "Failed to clear active UI stream id before new room stream:",
            error,
          );
        }
      }

      let uiStreamResumptionRegistered = false;
      let uiStreamResumptionRegistration: Promise<void> | undefined;

      let modelMessages: ModelMessage[];
      let originalUiMessages = uiMessages;
      if (parentMessageId) {
        const sender = await prisma.user.findUnique({
          where: { id: userContext.userId },
          select: { name: true },
        });
        const threadBuilt = await buildRoomStreamThreadModelMessages({
          roomId: room.id,
          parentMessageId,
          roomName: room.name,
          senderName: sender?.name?.trim() || "A teammate",
          lastUserMessageText,
        });
        modelMessages = threadBuilt.modelMessages;
        originalUiMessages = threadBuilt.uiMessages;
      } else {
        modelMessages = await convertToModelMessages(
          uiMessages.map(({ id: _id, ...rest }) => rest),
        );
      }

      const responsesApiResponseIdRef: { current: string | null } = {
        current: null,
      };

      const thoughtPhaseMs = {
        start: null as number | null,
        end: null as number | null,
        sawReasoningChunk: false,
      };

      const onInvalidProviderConversationId = async () => {
        if (parentMessageId) {
          // Thread conversations live on parent metadata — clear so next turn
          // recreates. Do not touch room.providerConversationId.
          try {
            const parent = await prisma.chatRoomMessage.findFirst({
              where: { id: parentMessageId, roomId: room.id },
              select: { metadata: true },
            });
            if (
              parent?.metadata &&
              typeof parent.metadata === "object" &&
              !Array.isArray(parent.metadata)
            ) {
              const next = {
                ...(parent.metadata as Record<string, unknown>),
              };
              delete next[THREAD_PROVIDER_CONVERSATION_ID_KEY];
              await prisma.chatRoomMessage.update({
                where: { id: parentMessageId },
                data: { metadata: next },
              });
            }
          } catch (error) {
            console.error(
              "Failed to clear thread providerConversationId after invalid remote conversation (POST /rooms/{id}/stream):",
              error,
            );
          }
          return;
        }
        try {
          await prisma.chatRoom.update({
            where: { id: room.id },
            data: { providerConversationId: null },
          });
        } catch (error) {
          console.error(
            "Failed to clear providerConversationId after invalid remote conversation (POST /rooms/{id}/stream):",
            error,
          );
        }
      };

      const sokosumiProviderOptions: SokosumiProviderCallOptions = {
        mode: "coworker",
        coworkerBaseUrl: coworker.baseURL.trim(),
        assertUrlAllowed: assertCoworkerBaseUrlIsPublic,
        coworkerSlug: coworker.slug,
        sokosumiUserId: userContext.userId,
        sokosumiOrganizationId: roomOrganizationId,
        previousResponseId: null,
        providerConversationId,
        imageGenerationModel: null,
        webSearchEnabled: false,
        onResponseStarted: async (responseId: string) => {
          responsesApiResponseIdRef.current = responseId;
          await setPendingResponseMirror(pendingResponseScope, responseId);
        },
        onResponseCompleted: async () => {
          await clearPendingResponseMirror(pendingResponseScope);
        },
        onInvalidProviderConversationId,
      };

      const result = streamText({
        model: getSokosumiProvider()(model ?? null),
        messages: modelMessages,
        allowSystemInMessages: true,
        maxRetries: 0,
        providerOptions: {
          sokosumi: sokosumiProviderOptions,
        } as unknown as Parameters<typeof streamText>[0]["providerOptions"],
        onChunk: ({ chunk }) => {
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
          const text = finishEvent.text?.trim() ?? "";
          if (!text) {
            return;
          }
          const hasReasoning =
            Array.isArray(finishEvent.reasoning) &&
            finishEvent.reasoning.length > 0;
          if (
            hasReasoning &&
            thoughtPhaseMs.start != null &&
            thoughtPhaseMs.end == null
          ) {
            thoughtPhaseMs.end = Date.now();
          }
          const thoughtTiming =
            hasReasoning && thoughtPhaseMs.start != null
              ? {
                  startedAtMs: thoughtPhaseMs.start,
                  endedAtMs: thoughtPhaseMs.end ?? Date.now(),
                }
              : undefined;
          const persistArgs = {
            roomId: room.id,
            senderCoworkerId: coworker.id,
            contentText: text,
            responsesApiResponseId: responsesApiResponseIdRef.current,
            reasoning: finishEvent.reasoning,
            thoughtTiming,
            parentMessageId,
          };
          // Retries: silent persist loss made streamed replies vanish after refetch.
          let lastError: unknown;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              await persistAssistantToChatRoom(persistArgs);
              return;
            } catch (error) {
              lastError = error;
              console.error(
                `Failed to persist assistant message (POST /rooms/{id}/stream) attempt ${attempt + 1}:`,
                error,
              );
            }
          }
          throw lastError instanceof Error
            ? lastError
            : new Error("Failed to persist assistant chat room message");
        },
      });

      return result.toUIMessageStreamResponse({
        originalMessages: originalUiMessages,
        generateMessageId: generateId,
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "x-sokosumi-room-id": room.id,
          ...(parentMessageId
            ? { "x-sokosumi-parent-message-id": parentMessageId }
            : {}),
        },
        onError: (error: unknown) => {
          console.error(
            "Coworker chat UI stream error (POST /rooms/{id}/stream):",
            error,
          );
          finalizeCoworkerStreamLock();
          return "An error occurred.";
        },
        ...(enableResumableUiStream
          ? {
              consumeSseStream: async ({ stream }) => {
                const streamId = generateId();
                const registration = (async () => {
                  try {
                    const ctx = getResumableUiStreamContext();
                    await ctx.createNewResumableStream(streamId, () => stream);
                    await setActiveUiStreamIdForRoom({
                      roomId: room.id,
                      userId: userContext.userId,
                      streamId,
                    });
                    uiStreamResumptionRegistered = true;
                  } catch (error) {
                    console.error(
                      "Failed to register resumable UI message stream:",
                      error,
                    );
                  }
                })();
                uiStreamResumptionRegistration = registration;
                await registration;
              },
              onFinish: async () => {
                finalizeCoworkerStreamLock();
                if (uiStreamResumptionRegistration) {
                  await uiStreamResumptionRegistration;
                }
                if (!uiStreamResumptionRegistered) {
                  return;
                }
                const clearParams = {
                  roomId: room.id,
                  userId: userContext.userId,
                };
                try {
                  await clearActiveUiStreamIdForRoom(clearParams);
                } catch (error) {
                  console.error(
                    "Failed to clear active UI stream id on stream finish:",
                    error,
                  );
                  try {
                    await clearActiveUiStreamIdForRoom(clearParams);
                  } catch (retryError) {
                    console.error(
                      "Retry failed to clear active UI stream id on stream finish:",
                      retryError,
                    );
                  }
                }
              },
            }
          : {
              onFinish: async () => {
                finalizeCoworkerStreamLock();
              },
            }),
      });
    } catch (error) {
      if (releaseOwnedCoworkerStreamLock) {
        const release = releaseOwnedCoworkerStreamLock;
        releaseOwnedCoworkerStreamLock = null;
        try {
          await release();
        } catch (releaseError) {
          console.error(
            "Failed to release coworker stream lock (POST /rooms/{id}/stream):",
            releaseError,
          );
        }
      }
      throw error;
    }
  });
}
