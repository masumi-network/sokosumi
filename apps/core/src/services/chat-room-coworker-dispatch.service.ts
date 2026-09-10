import type { SokosumiProviderCallOptions } from "@sokosumi/ai-provider";
import { coworkerTextLooksLikeAgentError } from "@sokosumi/ai-provider";
import { streamText } from "ai";
import { findUsableCoworkerByCapabilityInWorkspace } from "@/helpers/access-control";
import { invalidateChatRoomMessageReaders } from "@/helpers/chat-room-message-created-effects";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import {
  reasoningPartsToMetadata,
  thoughtMetadataFields,
} from "@/helpers/persist-assistant-to-chat-room";
import prisma from "@/lib/db/prisma";
import { createCoreLogger } from "@/lib/evlog";
import { getSokosumiProvider } from "@/lib/sokosumi-ai-provider";
import { resolveWorkspaceIdForChatRoom } from "@/routes/v1/chats/rooms/helpers";
import { createCoworkerConversation } from "@/routes/v1/chats/stream/coworker-conversation";

import {
  buildRoomMentionPrompt,
  loadRoomContextMessages,
} from "./chat-room-mention-context";
import {
  claimMentionForDispatch,
  markMentionFailed,
  ROOM_COWORKER_STREAM_TIMEOUT,
  ROOM_MENTION_GIVE_UP_MS,
} from "./chat-room-mention-state";
import {
  consumeMentionProviderStream,
  discardMentionThoughtPlaceholder,
  failMentionThoughtPlaceholder,
  failMentionWithCoworkerShell,
  publishMentionThoughtPlaceholder,
} from "./chat-room-mention-stream";
import { runSokoBotMentionDispatch } from "./chat-room-soko-bot-dispatch.service";

/** Cap Ably thought updates; first beat always publishes. */
const MENTION_THOUGHT_PUBLISH_MIN_INTERVAL_MS = 250;

/**
 * Clients poll a mention until it reaches a terminal state, so any escape from
 * the dispatch flow without marking the row pins them to an unbounded poll.
 * This is the single funnel that guarantees termination.
 */
export async function dispatchChatRoomMention(
  mentionId: string,
): Promise<void> {
  try {
    await runChatRoomMentionDispatch(mentionId);
  } catch (error) {
    console.error("Room coworker dispatch failed:", { mentionId, error });
    // Marking the row failed unpins the poller but says nothing to the person
    // watching the bubble. Anything that escaped after a placeholder was
    // opened — a thread lookup, a provider update, a room read — would leave
    // it streaming for ever, so end it here whatever threw.
    const linked = await prisma.chatRoomMention
      .findUnique({
        where: { id: mentionId },
        select: { responseMessageId: true, message: { select: { id: true } } },
      })
      .catch(() => null);
    if (linked?.responseMessageId) {
      await failMentionThoughtPlaceholder({
        placeholderId: linked.responseMessageId,
        sourceMessageId: linked.message.id,
        mentionId,
      }).catch((cleanupError) => {
        console.error("Failed to end the assistant bubble:", cleanupError);
      });
    }
    await markMentionFailed(mentionId, error);
  }
}

async function runChatRoomMentionDispatch(mentionId: string): Promise<void> {
  const mention = await prisma.chatRoomMention.findUnique({
    where: { id: mentionId },
    include: {
      coworker: {
        select: {
          id: true,
          slug: true,
          name: true,
          baseURL: true,
        },
      },
      sokoBot: {
        select: {
          id: true,
          userId: true,
          archivedAt: true,
        },
      },
      message: {
        include: {
          room: {
            select: {
              id: true,
              kind: true,
              name: true,
              organizationId: true,
            },
          },
          senderUser: {
            select: {
              id: true,
              name: true,
            },
          },
          senderCoworker: {
            select: {
              id: true,
              name: true,
            },
          },
          senderSokoBot: {
            select: {
              id: true,
              userId: true,
              archivedAt: true,
            },
          },
        },
      },
    },
  });

  if (!mention || mention.status === "responded") {
    return;
  }

  const mentionChatLog = mention.coworkerId != null ? createCoreLogger() : null;
  if (mentionChatLog) {
    mentionChatLog.set({
      chat: {
        kind: "coworker_channel_mention",
        room: { id: mention.message.room.id },
        ...(mention.coworker
          ? {
              coworker: {
                id: mention.coworker.id,
                slug: mention.coworker.slug,
              },
            }
          : mention.coworkerId
            ? { coworker: { id: mention.coworkerId } }
            : {}),
        ...(mention.message.parentMessageId
          ? { thread: { parentMessageId: mention.message.parentMessageId } }
          : {}),
        mention: { id: mentionId },
      },
    });
  }

  try {
    // Soft-delete wipes content and cancels pending/sent mentions, but a
    // waitUntil already in flight may still reach here — fail closed before
    // claiming so we do not burn credits or post under a tombstone.
    if (mention.message.deletedAt != null) {
      await markMentionFailed(mentionId, "Source message was deleted");
      return;
    }

    // Fail closed when the human sender row was deleted (SetNull): billing /
    // provider auth as the room creator would attribute cost to the wrong user.
    const failWithShell = (error: unknown) =>
      failMentionWithCoworkerShell({
        mentionId,
        sourceMessageId: mention.message.id,
        roomId: mention.message.roomId,
        parentMessageId: mention.message.parentMessageId,
        coworkerId: mention.coworkerId,
        sokoBotId: mention.sokoBotId,
        existingPlaceholderId: mention.responseMessageId,
        error,
      });

    // `instanceof` because unit fixtures build partial mention rows; the real
    // query selects every scalar, so this is always a Date in production.
    const askedAt = mention.createdAt;
    if (
      askedAt instanceof Date &&
      Date.now() - askedAt.getTime() > ROOM_MENTION_GIVE_UP_MS &&
      mention.status !== "responded"
    ) {
      await failWithShell("Soko Bot never picked this up; ask again");
      return;
    }

    // A bot may summon another bot, but only in an organization room: a personal
    // room has no shared workspace to run in, and every bot conversation stays
    // somewhere a person can see it.
    const senderBot = mention.message.senderSokoBot ?? null;
    const askedByBot =
      mention.message.senderUserId == null && senderBot != null;
    if (askedByBot && !mention.message.room.organizationId) {
      await failWithShell("Soko Bots can only talk to each other in a channel");
      return;
    }
    // The sending bot's owner is the workspace fallback and the attribution:
    // their assistant asked, so the console can say whose curiosity this was.
    const userId = mention.message.senderUserId ?? senderBot?.userId ?? null;
    if (!userId) {
      await failWithShell("Mention sender is no longer available");
      return;
    }
    if (askedByBot && senderBot?.archivedAt) {
      await failWithShell("The Soko Bot that asked is no longer active");
      return;
    }

    // Org room → org workspace; personal room → message sender personal workspace.
    let workspaceId: string;
    try {
      workspaceId = await resolveWorkspaceIdForChatRoom({
        organizationId: mention.message.room.organizationId,
        personalUserId: userId,
      });
    } catch {
      await failWithShell("Coworker chat is not available");
      return;
    }

    if (mention.sokoBotId) {
      await runSokoBotMentionDispatch({
        mentionId,
        mention,
        userId,
        workspaceId,
        failWithShell,
        askedByBot,
        chainDepth: mention.chainDepth,
      });
      return;
    }

    if (!mention.coworker) {
      await failWithShell("Mention target is no longer available");
      return;
    }

    const usableCoworker = await findUsableCoworkerByCapabilityInWorkspace(
      mention.coworker.id,
      workspaceId,
      "chat",
      prisma,
      { requireBaseUrl: true },
    );
    if (!usableCoworker?.baseURL?.trim()) {
      await failWithShell("Coworker chat is not available");
      return;
    }

    const coworker = {
      ...mention.coworker,
      baseURL: usableCoworker.baseURL,
    };

    // Roster is source of truth: a PATCH that drops this coworker must stop an
    // in-flight mention from posting after eviction.
    const membership = await prisma.chatRoomCoworkerMember.findUnique({
      where: {
        roomId_coworkerId: {
          roomId: mention.message.roomId,
          coworkerId: coworker.id,
        },
      },
      select: { id: true },
    });
    if (!membership) {
      await failWithShell("Coworker is no longer a member of this room");
      return;
    }

    // Claim before any provider work so concurrent dispatches cannot both run
    // streamText. Fresh `sent` (in flight) loses quietly; stale `sent` is
    // reclaimed after ROOM_SENT_STALE_MS.
    const claimed = await claimMentionForDispatch(mentionId);
    mentionChatLog?.set({
      chat: {
        mention: {
          id: mentionId,
          claim: claimed ? "claimed" : "already_in_flight",
        },
      },
    });
    if (!claimed) {
      return;
    }

    // Open the coworker bubble before conversation create so the room never
    // flashes Calling on the parent then jumps to Thinking.
    const generationStartedAtMs = Date.now();
    const parentMessageId = mention.message.parentMessageId;
    const linkedPlaceholderId = mention.responseMessageId;
    let placeholderId: string | null = null;
    if (linkedPlaceholderId) {
      const linked = await prisma.chatRoomMessage.findUnique({
        where: { id: linkedPlaceholderId },
        select: { id: true, deletedAt: true },
      });
      if (linked != null && linked.deletedAt == null) {
        placeholderId = linkedPlaceholderId;
      }
    }
    try {
      placeholderId = await publishMentionThoughtPlaceholder({
        placeholderId,
        roomId: mention.message.roomId,
        parentMessageId,
        sourceMessageId: mention.message.id,
        mentionId,
        coworkerId: coworker.id,
        reasoningSteps: [],
        thoughtStartedAtMs: generationStartedAtMs,
      });
    } catch (publishError) {
      console.error("Mention Thought placeholder create failed:", {
        mentionId,
        error: publishError,
      });
    }

    const senderName = mention.message.senderUser?.name ?? "A teammate";
    const baseURL = coworker.baseURL.trim();
    const threadRootId = mention.message.parentMessageId;
    let providerResponseId: string | null = null;

    // Inside a thread the same coworker keeps one provider conversation, so a
    // back-and-forth stays a dialogue instead of a series of cold starts.
    let existingProviderConversationId = mention.providerConversationId;
    if (!existingProviderConversationId && threadRootId) {
      const priorThreadMention = await prisma.chatRoomMention.findFirst({
        where: {
          coworkerId: coworker.id,
          providerConversationId: { not: null },
          message: {
            roomId: mention.message.roomId,
            OR: [{ id: threadRootId }, { parentMessageId: threadRootId }],
          },
        },
        orderBy: { createdAt: "desc" },
        select: { providerConversationId: true },
      });
      existingProviderConversationId =
        priorThreadMention?.providerConversationId ?? null;
    }

    let providerConversation: { id: string };
    try {
      providerConversation = existingProviderConversationId
        ? { id: existingProviderConversationId }
        : await createCoworkerConversation({
            responsesApiBaseUrl: baseURL,
            sokosumiUserId: userId,
            sokosumiOrganizationId: mention.message.room.organizationId,
            coworkerSlug: coworker.slug,
            sokosumiConversationId: mention.message.id,
          });
    } catch (error) {
      await failMentionThoughtPlaceholder({
        placeholderId,
        sourceMessageId: mention.message.id,
        mentionId,
      });
      throw error;
    }

    const activeMention = await prisma.chatRoomMention.updateMany({
      where: { id: mentionId, status: "sent" },
      data: {
        providerConversationId: providerConversation.id,
      },
    });
    // A late provider setup cannot advance a completed response's unread clock.
    if (activeMention.count !== 1) {
      const latest = await prisma.chatRoomMention.findUnique({
        where: { id: mentionId },
        select: { status: true },
      });
      if (latest?.status === "failed") {
        await failMentionThoughtPlaceholder({
          placeholderId,
          sourceMessageId: mention.message.id,
          mentionId,
          onlyWhenFailed: true,
        });
      }
      return;
    }

    const providerOptions: SokosumiProviderCallOptions = {
      mode: "coworker",
      coworkerBaseUrl: baseURL,
      coworkerSlug: coworker.slug,
      sokosumiUserId: userId,
      sokosumiOrganizationId: mention.message.room.organizationId,
      providerConversationId: providerConversation.id,
      onResponseStarted: (responseId: string) => {
        providerResponseId = responseId;
      },
    };

    // The coworker only ever receives what is addressed to it, so hand it the
    // surrounding conversation: the last messages of the thread it is replying
    // in, or of the room for a top-level mention (oldest first).
    const contextMessages = await loadRoomContextMessages({
      roomId: mention.message.roomId,
      messageId: mention.message.id,
      createdAt: mention.message.createdAt,
      threadRootId,
    });

    const prompt = buildRoomMentionPrompt({
      roomName: mention.message.room.name,
      senderName,
      content: mention.message.content,
      isThreadReply: threadRootId != null,
      contextMessages,
    });

    const result = streamText({
      model: getSokosumiProvider()(null),
      messages: [{ role: "user", content: prompt }],
      maxRetries: 0,
      timeout: ROOM_COWORKER_STREAM_TIMEOUT,
      providerOptions: {
        sokosumi: providerOptions,
      } as unknown as Parameters<typeof streamText>[0]["providerOptions"],
    });
    let lastThoughtPublishAt = 0;
    let thoughtPublishQueue = Promise.resolve();
    let mentionPublished = false;
    let keepFailedPlaceholder = false;
    let lostFinalizeClaim = false;

    try {
      const { text: streamedText, reasoningSteps: streamedReasoning } =
        await consumeMentionProviderStream(result, (steps) => {
          thoughtPublishQueue = thoughtPublishQueue
            .then(async () => {
              const now = Date.now();
              if (
                placeholderId != null &&
                now - lastThoughtPublishAt <
                  MENTION_THOUGHT_PUBLISH_MIN_INTERVAL_MS
              ) {
                return;
              }
              lastThoughtPublishAt = now;
              placeholderId = await publishMentionThoughtPlaceholder({
                placeholderId,
                roomId: mention.message.roomId,
                parentMessageId,
                sourceMessageId: mention.message.id,
                mentionId,
                coworkerId: coworker.id,
                reasoningSteps: steps,
                thoughtStartedAtMs: generationStartedAtMs,
              });
            })
            .catch((publishError) => {
              console.error("Mention Thought placeholder publish failed:", {
                mentionId,
                error: publishError,
              });
            });
        });
      await thoughtPublishQueue;

      let responseText = streamedText;
      if (!responseText) {
        responseText = ((await result.text) ?? "").trim();
      }
      let reasoningSteps = streamedReasoning;
      if (reasoningSteps.length === 0) {
        reasoningSteps = reasoningPartsToMetadata(await result.reasoning) ?? [];
      }
      const generationEndedAtMs = Date.now();
      if (!responseText || coworkerTextLooksLikeAgentError(responseText)) {
        await markMentionFailed(
          mentionId,
          responseText || "Coworker returned an empty response",
        );
        keepFailedPlaceholder = true;
        return;
      }

      const hasReasoning = reasoningSteps.length > 0;
      const thoughtTiming = hasReasoning
        ? {
            startedAtMs: generationStartedAtMs,
            endedAtMs: generationEndedAtMs,
          }
        : undefined;
      const thoughtMeta = thoughtMetadataFields(reasoningSteps, thoughtTiming);
      const replyMetadata = {
        in_reply_to_message_id: mention.message.id,
        mention_id: mention.id,
        ...thoughtMeta,
      };

      const publishedMessageIds = await prisma.$transaction(async (tx) => {
        // Re-check membership after the provider call: eviction during streamText
        // must not land a reply in a room the coworker left.
        const stillMember = await tx.chatRoomCoworkerMember.findUnique({
          where: {
            roomId_coworkerId: {
              roomId: mention.message.roomId,
              coworkerId: coworker.id,
            },
          },
          select: { id: true },
        });
        if (!stillMember) {
          await tx.chatRoomMention.updateMany({
            where: {
              id: mention.id,
              status: { in: ["pending", "sent"] },
            },
            data: {
              status: "failed",
              error: "Coworker is no longer a member of this room",
            },
          });
          return { kind: "failed" as const };
        }

        // Soft-delete during streamText cancels the mention to `failed` and
        // wipes content; do not post a reply under a tombstone.
        const sourceMessage = await tx.chatRoomMessage.findUnique({
          where: { id: mention.message.id },
          select: { deletedAt: true },
        });
        if (!sourceMessage || sourceMessage.deletedAt != null) {
          await tx.chatRoomMention.updateMany({
            where: {
              id: mention.id,
              status: { in: ["pending", "sent"] },
            },
            data: {
              status: "failed",
              error: "Source message was deleted",
            },
          });
          return { kind: "failed" as const };
        }

        // Claim before writing the reply so a losing worker cannot overwrite a
        // shared Thought placeholder. Lost claim returns without a message write.
        const finalized = await tx.chatRoomMention.updateMany({
          where: { id: mention.id, status: "sent" },
          data: {
            status: "responded",
            error: null,
            providerResponseId,
            ...(placeholderId ? { responseMessageId: placeholderId } : {}),
          },
        });

        if (finalized.count !== 1) {
          return { kind: "lost_claim" as const };
        }

        const responseMessage = placeholderId
          ? await tx.chatRoomMessage.update({
              where: { id: placeholderId },
              data: {
                content: responseText,
                metadata: replyMetadata,
              },
            })
          : await tx.chatRoomMessage.create({
              data: {
                roomId: mention.message.roomId,
                parentMessageId: mention.message.parentMessageId,
                senderCoworkerId: coworker.id,
                content: responseText,
                metadata: replyMetadata,
              },
            });

        if (!placeholderId) {
          await tx.chatRoomMention.update({
            where: { id: mention.id },
            data: { responseMessageId: responseMessage.id },
          });
        }

        await tx.chatRoom.update({
          where: { id: mention.message.roomId },
          data: { updatedAt: new Date() },
        });

        return {
          kind: "published" as const,
          responseMessageId: responseMessage.id,
          sourceMessageId: mention.message.id,
        };
      });

      if (!publishedMessageIds) {
        return;
      }
      if (publishedMessageIds.kind === "failed") {
        keepFailedPlaceholder = true;
        return;
      }
      if (publishedMessageIds.kind === "lost_claim") {
        lostFinalizeClaim = true;
        return;
      }

      mentionPublished = true;
      // Finalization advances the reply attention clock, even with a Thought placeholder.
      await Promise.all([
        invalidateChatRoomMessageReaders({
          roomId: mention.message.roomId,
          authorUserId: null,
        }),
        publishChatRoomMessageRealtimeById(
          publishedMessageIds.responseMessageId,
          placeholderId ? "update" : "create",
        ),
      ]);
      await publishChatRoomMessageRealtimeById(
        publishedMessageIds.sourceMessageId,
        "mention_status",
      );
    } catch (error) {
      keepFailedPlaceholder = true;
      throw error;
    } finally {
      if (!mentionPublished) {
        await thoughtPublishQueue.catch(() => undefined);
        const latest = await prisma.chatRoomMention.findUnique({
          where: { id: mentionId },
          select: { status: true, responseMessageId: true },
        });
        const winnerKeptRow =
          latest?.status === "responded" &&
          latest.responseMessageId === placeholderId;
        if (winnerKeptRow || lostFinalizeClaim) {
          // Winning worker owns this shell; a lost claim must not discard it.
        } else if (keepFailedPlaceholder || latest?.status === "failed") {
          await failMentionThoughtPlaceholder({
            placeholderId,
            sourceMessageId: mention.message.id,
            mentionId,
          });
        } else {
          await discardMentionThoughtPlaceholder(
            placeholderId,
            parentMessageId,
          );
        }
      }
    }
  } finally {
    mentionChatLog?.emit();
  }
}
