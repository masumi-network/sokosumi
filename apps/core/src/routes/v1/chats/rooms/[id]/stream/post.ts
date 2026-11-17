import { createRoute, z } from "@hono/zod-openapi";
import type { SokosumiProviderCallOptions } from "@sokosumi/ai-provider";
import { isOwnedUserChatRoomFileUrl } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import {
  convertToModelMessages,
  generateId,
  type ModelMessage,
  streamText,
  type UIMessage,
  validateUIMessages,
} from "ai";

import { requireCoworkerChatCapabilityInWorkspace } from "@/helpers/access-control";
import {
  clearActiveUiStreamIdForRoom,
  setActiveUiStreamIdForRoom,
} from "@/helpers/active-ui-stream-room-metadata";
import { deleteChatRoomMessageMetadataKeys } from "@/helpers/chat-room-message-metadata-patch";
import {
  trackLateCoworkerResponse,
  untrackLateCoworkerResponse,
} from "@/helpers/coworker-late-responses";
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
  emitCoreError,
  recordCoreError,
  runAsBackgroundWork,
  tryUseLogger,
} from "@/lib/evlog";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  getResumableUiStreamContext,
  isUiStreamResumptionConfigured,
} from "@/lib/resumable-ui-stream-context";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
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
  resolveWorkspaceIdForChatRoom,
} from "../../helpers";
import { ensureCoworkerProviderConversationForRoom } from "./coworker-provider-conversation";

/**
 * Room-keyed coworker 1:1 stream (MVP).
 *
 * Deferred to follow-up (parity with legacy conversation stream):
 * - Image generation / OpenRouter paths
 * - Web search
 *
 * Attachments arrive as `file` parts on the last user message (public Blob
 * URLs) and reach the model as image/file input; the persisted room message
 * keeps the markdown links from the text part.
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

/** File parts are fetched by the coworker model. Only this user's uploads in this room. */
function requireOwnedRoomStreamFileParts(
  messages: UIMessage[],
  userId: string,
  roomId: string,
): void {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "file") {
        continue;
      }
      const url =
        "url" in part && typeof part.url === "string" ? part.url : null;
      if (!url || !isOwnedUserChatRoomFileUrl(url, userId, roomId)) {
        throw badRequest(
          "File parts must be chat uploads owned by you in this room.",
        );
      }
    }
  }
}

const route = withOrganizationSlugHeaderParameter(
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
      parentMessageId: requestedParentMessageId,
      quote: requestedQuote,
    } = c.req.valid("json");

    if (!Array.isArray(messages) || messages.length === 0) {
      throw unprocessableEntity(AI_SDK_CHAT_MESSAGES_REQUIREMENT);
    }

    const room = await requireChatRoomUserWriteAccess(
      roomId,
      userContext.userId,
      prisma,
    );

    // Match web `isCoworkerOnlyDirectRoom` and message-POST skip-mention:
    // stream is only for 1:1 human↔coworker directs, never multi-human
    // channels that happen to include a coworker.
    const isCoworkerOnlyDirect =
      room.kind === "direct" &&
      room.coworkerMembers.length === 1 &&
      room.sokoBotMembers.length === 0 &&
      room.userMembers.length === 1 &&
      room.userMembers[0]?.userId === userContext.userId;
    if (!isCoworkerOnlyDirect) {
      throw badRequest(
        "Room stream requires a 1:1 direct with exactly one AI coworker member. Use message POST for channels and human-only rooms.",
      );
    }

    const parentMessageId = await resolveThreadParentMessageId(
      prisma,
      room.id,
      requestedParentMessageId,
    );
    const quote = await resolveRoomQuoteSnapshot(
      prisma,
      room.id,
      requestedQuote?.messageId,
    );
    const userMessageMetadata = mergeChatRoomMessageMetadata(null, quote);

    const roomCoworker = room.coworkerMembers[0]!.coworker;
    const workspaceId = await resolveWorkspaceIdForChatRoom({
      organizationId: room.organizationId,
      personalUserId: userContext.userId,
    });
    const coworker = await requireCoworkerChatCapabilityInWorkspace(
      roomCoworker.id,
      workspaceId,
    );
    if (!coworker.baseURL?.trim()) {
      throw serviceUnavailable(
        "Coworker chat is not available: no Responses API URL configured for this coworker.",
      );
    }

    const uiMessages = mapChatRequestToUiMessages(messages);
    await validateUiMessagesOrBadRequest(uiMessages);
    requireOwnedRoomStreamFileParts(uiMessages, userContext.userId, room.id);

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

    const lastUserFileParts =
      (lastMessage.role === "user" || lastMessage.role === "system") &&
      "parts" in lastMessage &&
      Array.isArray(lastMessage.parts)
        ? lastMessage.parts.filter(
            (part): part is Extract<typeof part, { type: "file" }> =>
              part.type === "file",
          )
        : [];

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
    tryUseLogger()?.set({
      chat: {
        kind: "coworker_direct_stream",
        room: { id: room.id },
        coworker: { id: coworker.id, slug: coworker.slug },
        ...(parentMessageId ? { thread: { parentMessageId } } : {}),
        lock: { status: streamLock.status },
      },
    });
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
    // What every event below names; most of them come after the response.
    // Each of them can follow an error that quotes the prompt or the reply
    // (stream metadata, Redis, the remote conversation): content-free fields
    // only, never `cause`.
    const streamLogContext = {
      operation: "chat_room_coworker_stream",
      roomId: room.id,
      coworkerId: coworker.id,
      ...(parentMessageId ? { parentMessageId } : {}),
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
      waitUntil(
        runAsBackgroundWork(() =>
          clearPendingResponseMirror(pendingResponseScope),
        ),
      );
      const release = releaseOwnedCoworkerStreamLock;
      if (!release) {
        return;
      }
      releaseOwnedCoworkerStreamLock = null;
      waitUntil(runAsBackgroundWork(() => release()));
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
          recordCoreError(
            streamLogContext,
            {
              message: "Could not clear a chat room's previous stream id",
              why: "Writing the room's stream metadata failed before the new stream",
              fix: "A reconnecting client may resume the previous stream until this one registers. If it repeats, check the database.",
            },
            { failure: messageSafeErrorFields(error) },
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
          lastUserFileParts,
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

      // Full generation wall-clock for product "Thought for …" (not reasoning-token span only).
      const generationStartedAtMs = Date.now();

      const onInvalidProviderConversationId = async () => {
        if (parentMessageId) {
          // Thread conversations live on parent metadata — clear so next turn
          // recreates. Do not touch room.providerConversationId. Atomic key
          // delete preserves concurrent unfurls / quote / membership.
          try {
            await deleteChatRoomMessageMetadataKeys({
              messageId: parentMessageId,
              keys: [THREAD_PROVIDER_CONVERSATION_ID_KEY],
              requireNotDeleted: false,
            });
          } catch (error) {
            // Runs while the reply streams, after the response.
            emitCoreError(
              streamLogContext,
              {
                message: "Could not reset a thread's coworker conversation",
                why: "Clearing the invalid conversation id on the thread failed",
                fix: "The thread's next turn fails the same way until the id is cleared; delete providerConversationId from the parent message's metadata.",
              },
              { failure: messageSafeErrorFields(error) },
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
          // Runs while the reply streams, after the response.
          emitCoreError(
            streamLogContext,
            {
              message: "Could not reset a chat room's coworker conversation",
              why: "Clearing the invalid conversation id on the room failed",
              fix: "The room's next turn fails the same way until the id is cleared; set the room's providerConversationId to null.",
            },
            { failure: messageSafeErrorFields(error) },
          );
        }
      };

      const sokosumiProviderOptions: SokosumiProviderCallOptions = {
        mode: "coworker",
        coworkerBaseUrl: coworker.baseURL.trim(),
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
          // Delivered by the late-responses sync if it outlives this request.
          await trackLateCoworkerResponse({
            responseId,
            roomId: room.id,
            parentMessageId: parentMessageId ?? null,
            coworkerId: coworker.id,
            userId: userContext.userId,
            organizationId: roomOrganizationId,
            startedAtMs: Date.now(),
          });
        },
        onResponseCompleted: async () => {
          await clearPendingResponseMirror(pendingResponseScope);
        },
        onInvalidProviderConversationId,
      };

      const result = streamText({
        model: getSokosumiProvider()(null),
        messages: modelMessages,
        allowSystemInMessages: true,
        maxRetries: 0,
        providerOptions: {
          sokosumi: sokosumiProviderOptions,
        } as unknown as Parameters<typeof streamText>[0]["providerOptions"],
        onFinish: async (finishEvent) => {
          const text = finishEvent.text?.trim() ?? "";
          if (!text) {
            return;
          }
          const hasReasoning =
            Array.isArray(finishEvent.reasoning) &&
            finishEvent.reasoning.length > 0;
          const thoughtTiming = hasReasoning
            ? {
                startedAtMs: generationStartedAtMs,
                endedAtMs: Date.now(),
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
              if (responsesApiResponseIdRef.current) {
                await untrackLateCoworkerResponse(
                  responsesApiResponseIdRef.current,
                );
              }
              return;
            } catch (error) {
              lastError = error;
              // The write carries the reply's text, which a database
              // error quotes: content-free fields only.
              emitCoreError(
                streamLogContext,
                {
                  message: "Could not save a coworker's streamed reply",
                  why: "Writing the reply to the room failed",
                  fix: "The attempt is repeated up to three times; if every attempt fails, the reply is lost after a refresh. Look up the error name and code under failure.",
                },
                {
                  attempt: attempt + 1,
                  failure: messageSafeErrorFields(error),
                },
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
          // The stream's error can quote the prompt or the reply:
          // content-free fields only.
          emitCoreError(
            streamLogContext,
            {
              message: "A coworker's chat reply stream failed",
              why: "The UI message stream reported an error",
              fix: "The user sees an error in place of the reply. If it repeats, check the coworker's Responses API; look up the error name and code under failure.",
            },
            { failure: messageSafeErrorFields(error) },
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
                    // Registration copies the stream, so its error can
                    // quote the reply: content-free fields only.
                    emitCoreError(
                      streamLogContext,
                      {
                        message: "Could not make a chat reply stream resumable",
                        why: "Registering the stream for resumption failed",
                        fix: "A client that reconnects mid-reply waits for the saved message instead. If it repeats, check Redis.",
                      },
                      { failure: messageSafeErrorFields(error) },
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
                  emitCoreError(
                    streamLogContext,
                    {
                      message:
                        "Could not clear a finished chat stream's id on the first try",
                      why: "Writing the room's stream metadata failed",
                      fix: "The clear is tried once more right away; a second error follows only if that fails too. If it repeats, check the database.",
                    },
                    { failure: messageSafeErrorFields(error) },
                  );
                  try {
                    await clearActiveUiStreamIdForRoom(clearParams);
                  } catch (retryError) {
                    emitCoreError(
                      streamLogContext,
                      {
                        message: "Gave up clearing a finished chat stream's id",
                        why: "Writing the room's stream metadata failed twice",
                        fix: "Clients may try to resume the finished stream until the next one replaces the id. If it repeats, check the database.",
                      },
                      { failure: messageSafeErrorFields(retryError) },
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
          recordCoreError(
            streamLogContext,
            {
              message: "Could not release a chat room's coworker stream lock",
              why: "Releasing the lock in Redis failed while the request was failing",
              fix: "New replies in this room answer 409 until the lock expires. If it repeats, check Redis.",
            },
            { failure: messageSafeErrorFields(releaseError) },
          );
        }
      }
      throw error;
    }
  });
}
