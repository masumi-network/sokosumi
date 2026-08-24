import type { SokosumiProviderCallOptions } from "@sokosumi/ai-provider";
import { coworkerTextLooksLikeAgentError } from "@sokosumi/ai-provider";
import { streamText } from "ai";

import { findUsableCoworkerByCapabilityInWorkspace } from "@/helpers/access-control";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import {
  reasoningPartsToMetadata,
  thoughtMetadataFields,
} from "@/helpers/persist-assistant-to-chat-room";
import prisma from "@/lib/db/prisma";
import { getSokosumiProvider } from "@/lib/sokosumi-ai-provider";
import { resolveWorkspaceIdForChatRoom } from "@/routes/v1/chats/rooms/helpers";
import { createCoworkerConversation } from "@/routes/v1/chats/stream/coworker-conversation";

/** Hard ceiling for streamText only (not conversation create ≤25s). */
export const ROOM_COWORKER_TOTAL_MS = 240_000;
/** AI SDK stall budget after content has started; content chunks reset this. */
export const ROOM_COWORKER_CHUNK_MS = 90_000;

/**
 * No `firstChunkMs`: some coworkers think/tool for >90s with no content-bearing
 * SSE. Mentions are waitUntil jobs and must still terminate — `totalMs` is that
 * bound. `chunkMs` still kills a stall after output starts. Coworker 1:1 DMs
 * omit this timeout entirely (live SSE + function cap).
 */
export const ROOM_COWORKER_STREAM_TIMEOUT = {
  totalMs: ROOM_COWORKER_TOTAL_MS,
  chunkMs: ROOM_COWORKER_CHUNK_MS,
} as const;

/** Must exceed `ROOM_COWORKER_TOTAL_MS` so reclaim cannot steal an in-flight run. */
export const ROOM_SENT_STALE_MS = ROOM_COWORKER_TOTAL_MS + 30_000;
const STALE_SENT_RECLAIM_LIMIT = 10;
/** Cap Ably thought updates; first beat always publishes. */
const MENTION_THOUGHT_PUBLISH_MIN_INTERVAL_MS = 250;

interface MentionStreamPart {
  type: string;
  text?: string;
  error?: unknown;
}

interface MentionStreamConsumption {
  text: string;
  reasoningSteps: Array<{ type: string; text: string }>;
}

function mentionStreamIterable(result: {
  fullStream?: AsyncIterable<MentionStreamPart>;
  stream?: AsyncIterable<MentionStreamPart>;
}): AsyncIterable<MentionStreamPart> | null {
  if (
    result.fullStream &&
    typeof result.fullStream[Symbol.asyncIterator] === "function"
  ) {
    return result.fullStream;
  }
  if (
    result.stream &&
    typeof result.stream[Symbol.asyncIterator] === "function"
  ) {
    return result.stream;
  }
  return null;
}

function previewReasoningSteps(
  completed: Array<{ type: string; text: string }>,
  currentDelta: string,
): Array<{ type: string; text: string }> {
  const trimmed = currentDelta.trim();
  if (!trimmed) {
    return completed;
  }
  return [...completed, { type: "reasoning", text: trimmed }];
}

async function consumeMentionProviderStream(
  result: {
    fullStream?: AsyncIterable<MentionStreamPart>;
    stream?: AsyncIterable<MentionStreamPart>;
    text?: PromiseLike<string>;
    reasoning?: PromiseLike<unknown>;
  },
  onThought: (steps: Array<{ type: string; text: string }>) => void,
): Promise<MentionStreamConsumption> {
  const iterable = mentionStreamIterable(result);
  if (!iterable) {
    const responseText = ((await result.text) ?? "").trim();
    const reasoningSteps =
      reasoningPartsToMetadata(await result.reasoning) ?? [];
    return { text: responseText, reasoningSteps };
  }

  const reasoningSteps: Array<{ type: string; text: string }> = [];
  let currentReasoning = "";
  let text = "";

  for await (const part of iterable) {
    if (part.type === "reasoning-delta" && typeof part.text === "string") {
      currentReasoning += part.text;
      const preview = previewReasoningSteps(reasoningSteps, currentReasoning);
      if (preview.length > 0) {
        onThought(preview);
      }
    } else if (
      part.type === "reasoning" ||
      part.type === "reasoning-end" ||
      part.type === "reasoning-part-finish"
    ) {
      const stepText =
        typeof part.text === "string" && part.text.trim().length > 0
          ? part.text.trim()
          : currentReasoning.trim();
      if (stepText) {
        reasoningSteps.push({ type: "reasoning", text: stepText });
      }
      currentReasoning = "";
      if (reasoningSteps.length > 0) {
        onThought(reasoningSteps);
      }
    } else if (part.type === "text-delta" && typeof part.text === "string") {
      text += part.text;
    } else if (part.type === "error") {
      const message =
        typeof part.error === "string"
          ? part.error
          : part.error instanceof Error
            ? part.error.message
            : "Coworker stream error";
      throw new Error(message);
    }
  }

  if (currentReasoning.trim()) {
    reasoningSteps.push({
      type: "reasoning",
      text: currentReasoning.trim(),
    });
  }

  return { text: text.trim(), reasoningSteps };
}

async function publishMentionThoughtPlaceholder(params: {
  placeholderId: string | null;
  roomId: string;
  parentMessageId: string | null;
  sourceMessageId: string;
  mentionId: string;
  coworkerId: string;
  reasoningSteps: Array<{ type: string; text: string }>;
}): Promise<string> {
  const metadata = {
    in_reply_to_message_id: params.sourceMessageId,
    mention_id: params.mentionId,
    streaming: true,
    reasoning: params.reasoningSteps,
  };
  if (params.placeholderId) {
    await prisma.chatRoomMessage.update({
      where: { id: params.placeholderId },
      data: { metadata },
    });
    await publishChatRoomMessageRealtimeById(params.placeholderId, "update");
    return params.placeholderId;
  }
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.chatRoomMessage.create({
      data: {
        roomId: params.roomId,
        parentMessageId: params.parentMessageId,
        senderCoworkerId: params.coworkerId,
        content: "",
        metadata,
      },
    });
    await tx.chatRoomMention.update({
      where: { id: params.mentionId },
      data: { responseMessageId: row.id },
    });
    return row;
  });
  try {
    await publishChatRoomMessageRealtimeById(created.id, "create");
  } catch (publishError) {
    console.error("Mention Thought placeholder Ably create failed:", {
      mentionId: params.mentionId,
      error: publishError,
    });
  }
  return created.id;
}

async function discardMentionThoughtPlaceholder(
  placeholderId: string | null,
  parentMessageId: string | null,
): Promise<void> {
  if (!placeholderId) {
    return;
  }
  await publishChatRoomMessageRealtimeById(placeholderId, "delete");
  await prisma.chatRoomMessage
    .delete({ where: { id: placeholderId } })
    .catch(() => undefined);
  if (parentMessageId) {
    await publishChatRoomMessageRealtimeById(parentMessageId, "update");
  }
}

/** Keep the assistant bubble so fail + Retry can live on it. */
async function failMentionThoughtPlaceholder(params: {
  placeholderId: string | null;
  sourceMessageId: string;
  mentionId: string;
}): Promise<void> {
  if (!params.placeholderId) {
    return;
  }
  await prisma.chatRoomMessage
    .update({
      where: { id: params.placeholderId },
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: params.sourceMessageId,
          mention_id: params.mentionId,
          mention_failed: true,
        },
      },
    })
    .catch(() => undefined);
  await publishChatRoomMessageRealtimeById(params.placeholderId, "update");
}

/** How many prior messages the coworker sees as conversation context. */
const ROOM_CONTEXT_MESSAGE_LIMIT = 10;
/** Per-message cap inside the context block so one wall of text cannot eat the prompt. */
const ROOM_CONTEXT_MESSAGE_MAX_CHARS = 500;

export interface RoomContextMessage {
  senderName: string;
  isCoworker: boolean;
  content: string;
}

function formatContextLine(message: RoomContextMessage): string {
  const flattened = message.content.replace(/\s+/g, " ").trim();
  const truncated =
    flattened.length > ROOM_CONTEXT_MESSAGE_MAX_CHARS
      ? `${flattened.slice(0, ROOM_CONTEXT_MESSAGE_MAX_CHARS)}…`
      : flattened;
  const senderLabel = message.isCoworker
    ? `${message.senderName} (AI coworker)`
    : message.senderName;
  return `- ${senderLabel}: ${truncated}`;
}

/**
 * Prompt sent to a coworker for a room mention or thread reply. The
 * CONTEXT block carries the recent messages the coworker never saw (it only
 * receives what is addressed to it), oldest first. Nothing in it is secret —
 * it is the same room history the humans in the room can read.
 */
export function buildRoomMentionPrompt(params: {
  roomName: string;
  senderName: string;
  content: string;
  isThreadReply: boolean;
  contextMessages: readonly RoomContextMessage[];
}): string {
  const action = params.isThreadReply
    ? "replied to a thread you are part of"
    : "mentioned you";
  const messageBlock = `${params.senderName} ${action} in #${params.roomName}:\n\n${params.content}`;

  if (params.contextMessages.length === 0) {
    return messageBlock;
  }

  const contextLines = params.contextMessages.map(formatContextLine);
  return `CONTEXT (last ${params.contextMessages.length} messages in #${params.roomName}):\n${contextLines.join("\n")}\n\n${messageBlock}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function markMentionFailed(
  mentionId: string,
  error: unknown,
): Promise<void> {
  // updateMany (not update) so a deleted row is a no-op instead of a throw, and
  // so a late failure can never overwrite an already committed response.
  await prisma.chatRoomMention
    .updateMany({
      where: { id: mentionId, status: { not: "responded" } },
      data: {
        status: "failed",
        error: errorMessage(error).slice(0, 500),
      },
    })
    .catch((updateError) => {
      console.error("Failed to mark room mention as failed:", updateError);
    });
}

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
    await markMentionFailed(mentionId, error);
  }
}

/**
 * Ids of `sent` mentions abandoned after a killed `waitUntil` (or similar).
 * Callers schedule `dispatchChatRoomMention` for each so reclaim can run.
 */
export async function listStaleSentChatRoomMentionIds(
  roomId: string,
  options?: { limit?: number; now?: Date },
): Promise<string[]> {
  const now = options?.now ?? new Date();
  const staleBefore = new Date(now.getTime() - ROOM_SENT_STALE_MS);
  const rows = await prisma.chatRoomMention.findMany({
    where: {
      status: "sent",
      updatedAt: { lt: staleBefore },
      message: { roomId },
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: options?.limit ?? STALE_SENT_RECLAIM_LIMIT,
  });
  return rows.map((row) => row.id);
}

/**
 * Win the dispatch slot: `pending` → `sent`, or reclaim a stale `sent` row
 * left behind when the previous worker died after claiming.
 */
async function claimMentionForDispatch(mentionId: string): Promise<boolean> {
  const pendingClaim = await prisma.chatRoomMention.updateMany({
    where: { id: mentionId, status: "pending" },
    data: {
      status: "sent",
      error: null,
    },
  });
  if (pendingClaim.count > 0) {
    return true;
  }

  const staleBefore = new Date(Date.now() - ROOM_SENT_STALE_MS);
  const staleClaim = await prisma.chatRoomMention.updateMany({
    where: {
      id: mentionId,
      status: "sent",
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: "sent",
      error: null,
    },
  });
  return staleClaim.count > 0;
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
      message: {
        include: {
          room: {
            select: {
              id: true,
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
        },
      },
    },
  });

  if (!mention || mention.status === "responded") {
    return;
  }

  // Soft-delete wipes content and cancels pending/sent mentions, but a
  // waitUntil already in flight may still reach here — fail closed before
  // claiming so we do not burn credits or post under a tombstone.
  if (mention.message.deletedAt != null) {
    await markMentionFailed(mentionId, "Source message was deleted");
    return;
  }

  // Fail closed when the human sender row was deleted (SetNull): billing /
  // provider auth as the room creator would attribute cost to the wrong user.
  const userId = mention.message.senderUserId;
  if (!userId) {
    await markMentionFailed(mentionId, "Mention sender is no longer available");
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
    await markMentionFailed(mentionId, "Coworker chat is not available");
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
    await markMentionFailed(mentionId, "Coworker chat is not available");
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
    await markMentionFailed(
      mentionId,
      "Coworker is no longer a member of this room",
    );
    return;
  }

  // Claim before any provider work so concurrent dispatches cannot both run
  // streamText. Fresh `sent` (in flight) loses quietly; stale `sent` is
  // reclaimed after ROOM_SENT_STALE_MS.
  const claimed = await claimMentionForDispatch(mentionId);
  if (!claimed) {
    return;
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

  const providerConversation = existingProviderConversationId
    ? { id: existingProviderConversationId }
    : await createCoworkerConversation({
        responsesApiBaseUrl: baseURL,
        sokosumiUserId: userId,
        sokosumiOrganizationId: mention.message.room.organizationId,
        coworkerSlug: coworker.slug,
        sokosumiConversationId: mention.message.id,
      });

  await prisma.chatRoomMention.update({
    where: { id: mentionId },
    data: {
      providerConversationId: providerConversation.id,
    },
  });

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
  const contextRows = await prisma.chatRoomMessage.findMany({
    where: {
      roomId: mention.message.roomId,
      id: { not: mention.message.id },
      deletedAt: null,
      createdAt: { lte: mention.message.createdAt },
      ...(threadRootId
        ? { OR: [{ id: threadRootId }, { parentMessageId: threadRootId }] }
        : // Top-level mentions should not pull thread replies into CONTEXT.
          { parentMessageId: null }),
    },
    orderBy: { createdAt: "desc" },
    take: ROOM_CONTEXT_MESSAGE_LIMIT,
    select: {
      content: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
    },
  });

  const contextMessages: RoomContextMessage[] = contextRows
    .reverse()
    .map((row) => ({
      senderName:
        row.senderCoworker?.name ?? row.senderUser?.name ?? "Unknown sender",
      isCoworker: row.senderCoworker != null,
      content: row.content,
    }));

  const prompt = buildRoomMentionPrompt({
    roomName: mention.message.room.name,
    senderName,
    content: mention.message.content,
    isThreadReply: threadRootId != null,
    contextMessages,
  });

  // Idle chunk timeouts abort stalls; totalMs is the hard ceiling.
  // Wall-clock generation time (not reasoning-token phase only) — product
  // "Thought for …" matches the live "is thinking" timer the user saw.
  const generationStartedAtMs = Date.now();
  const result = streamText({
    model: getSokosumiProvider()(null),
    messages: [{ role: "user", content: prompt }],
    maxRetries: 0,
    timeout: ROOM_COWORKER_STREAM_TIMEOUT,
    providerOptions: {
      sokosumi: providerOptions,
    } as unknown as Parameters<typeof streamText>[0]["providerOptions"],
  });

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
  let lastThoughtPublishAt = 0;
  let thoughtPublishQueue = Promise.resolve();
  let mentionPublished = false;
  let keepFailedPlaceholder = false;
  const parentMessageId = mention.message.parentMessageId;

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

      // Persist the reply first, then claim the mention transition. If another
      // worker already finalized (or reclaim stole the claim), discard this
      // duplicate reply so the room does not double-post.
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

      const finalized = await tx.chatRoomMention.updateMany({
        where: { id: mention.id, status: "sent" },
        data: {
          status: "responded",
          error: null,
          providerResponseId,
          responseMessageId: responseMessage.id,
        },
      });

      if (finalized.count !== 1) {
        // Leave a streaming placeholder for discard so Ably can still load it.
        if (!placeholderId) {
          await tx.chatRoomMessage.delete({
            where: { id: responseMessage.id },
          });
        }
        return { kind: "lost_claim" as const };
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
      return;
    }

    mentionPublished = true;
    await publishChatRoomMessageRealtimeById(
      publishedMessageIds.responseMessageId,
      placeholderId ? "update" : "create",
    );
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
      if (winnerKeptRow) {
        // Winning worker already finalized this row.
      } else if (keepFailedPlaceholder || latest?.status === "failed") {
        await failMentionThoughtPlaceholder({
          placeholderId,
          sourceMessageId: mention.message.id,
          mentionId,
        });
      } else {
        await discardMentionThoughtPlaceholder(placeholderId, parentMessageId);
      }
    }
  }
}
