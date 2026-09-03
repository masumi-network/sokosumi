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
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";

/** Hard ceiling for streamText only (not conversation create ≤25s). */
export const ROOM_COWORKER_TOTAL_MS = 240_000;

/**
 * Accepting a Soko Bot turn — classify, build the context packet, insert the
 * row — happens before any turn exists to look at. When that stalled, the
 * invocation was killed with the placeholder still spinning and nothing in the
 * admin overview to explain it, because there was no turn. Bounded so the
 * owner gets a failed reply instead of a "Thinking…" that never ends.
 */
const SOKO_BOT_ACCEPT_TIMEOUT_MS = 60_000;
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

/**
 * After this long a mention is given up on rather than reclaimed again.
 *
 * Reclaim exists for a worker that died mid-dispatch, and it retries by
 * re-running the same work. When the cause is not transient the mention is
 * reclaimed for ever and the asker watches "Thinking…" indefinitely: the turn
 * that would have carried a deadline was never created, so nothing else can
 * end it. Past this age the reply says it failed.
 */
const ROOM_MENTION_GIVE_UP_MS = 15 * 60_000;
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
  coworkerId?: string | null;
  orchestratorId?: string | null;
  reasoningSteps: Array<{ type: string; text: string }>;
  thoughtStartedAtMs: number;
}): Promise<string> {
  const metadata: Record<string, unknown> = {
    in_reply_to_message_id: params.sourceMessageId,
    mention_id: params.mentionId,
    streaming: true,
    reasoning: params.reasoningSteps,
  };
  if (params.thoughtStartedAtMs > 0) {
    metadata.thought_timing_ms = { start: params.thoughtStartedAtMs };
  }
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
        senderCoworkerId: params.coworkerId ?? null,
        senderOrchestratorId: params.orchestratorId ?? null,
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
    // Swallowing this once left the bubble streaming for ever while the
    // mention was marked terminally failed, so nothing would revisit it. One
    // retry, then delete: an empty space is honest, a spinner that never
    // stops is not.
    .catch(async () => {
      await prisma.chatRoomMessage
        .update({
          where: { id: params.placeholderId as string },
          data: {
            content: "",
            metadata: {
              in_reply_to_message_id: params.sourceMessageId,
              mention_id: params.mentionId,
              mention_failed: true,
            },
          },
        })
        .catch(async () => {
          await prisma.chatRoomMessage
            .delete({ where: { id: params.placeholderId as string } })
            .catch(() => undefined);
        });
    });
  await publishChatRoomMessageRealtimeById(params.placeholderId, "update");
}

/** Pre-claim fail still needs a coworker bubble; parent has no mention footer. */
async function failMentionWithCoworkerShell(params: {
  mentionId: string;
  sourceMessageId: string;
  roomId: string;
  parentMessageId: string | null;
  coworkerId?: string | null;
  orchestratorId?: string | null;
  existingPlaceholderId: string | null;
  error: unknown;
}): Promise<void> {
  let placeholderId = params.existingPlaceholderId;
  if (placeholderId) {
    const linked = await prisma.chatRoomMessage.findUnique({
      where: { id: placeholderId },
      select: { id: true, deletedAt: true },
    });
    if (linked == null || linked.deletedAt != null) {
      placeholderId = null;
    }
  }
  try {
    if (!placeholderId) {
      placeholderId = await publishMentionThoughtPlaceholder({
        placeholderId: null,
        roomId: params.roomId,
        parentMessageId: params.parentMessageId,
        sourceMessageId: params.sourceMessageId,
        mentionId: params.mentionId,
        coworkerId: params.coworkerId,
        orchestratorId: params.orchestratorId,
        reasoningSteps: [],
        thoughtStartedAtMs: 0,
      });
    }
    await failMentionThoughtPlaceholder({
      placeholderId,
      sourceMessageId: params.sourceMessageId,
      mentionId: params.mentionId,
    });
  } catch (publishError) {
    console.error("Mention failed-shell create failed:", {
      mentionId: params.mentionId,
      error: publishError,
    });
  }
  await markMentionFailed(params.mentionId, params.error);
}

/** How many prior messages the coworker sees as conversation context. */
const ROOM_CONTEXT_MESSAGE_LIMIT = 10;
/** Per-message cap inside the context block so one wall of text cannot eat the prompt. */
const ROOM_CONTEXT_MESSAGE_MAX_CHARS = 500;

export interface RoomContextMessage {
  senderName: string;
  isCoworker: boolean;
  isOrchestrator?: boolean;
  content: string;
}

function formatContextLine(message: RoomContextMessage): string {
  const flattened = message.content.replace(/\s+/g, " ").trim();
  const truncated =
    flattened.length > ROOM_CONTEXT_MESSAGE_MAX_CHARS
      ? `${flattened.slice(0, ROOM_CONTEXT_MESSAGE_MAX_CHARS)}…`
      : flattened;
  const senderLabel = message.isOrchestrator
    ? `${message.senderName} (personal assistant)`
    : message.isCoworker
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

async function loadRoomContextMessages(params: {
  roomId: string;
  messageId: string;
  createdAt: Date;
  threadRootId: string | null;
}): Promise<RoomContextMessage[]> {
  const contextRows = await prisma.chatRoomMessage.findMany({
    where: {
      roomId: params.roomId,
      id: { not: params.messageId },
      deletedAt: null,
      createdAt: { lte: params.createdAt },
      ...(params.threadRootId
        ? {
            OR: [
              { id: params.threadRootId },
              { parentMessageId: params.threadRootId },
            ],
          }
        : // Top-level mentions should not pull thread replies into CONTEXT.
          { parentMessageId: null }),
    },
    orderBy: { createdAt: "desc" },
    take: ROOM_CONTEXT_MESSAGE_LIMIT,
    select: {
      content: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
      senderOrchestrator: { select: { name: true } },
    },
  });
  return contextRows.reverse().map((row) => ({
    senderName:
      row.senderOrchestrator?.name?.trim() ||
      row.senderCoworker?.name ||
      row.senderUser?.name ||
      "Unknown sender",
    isCoworker: row.senderCoworker != null,
    isOrchestrator: row.senderOrchestrator != null,
    content: row.content,
  }));
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
      // `pending` too: a mention is written in one transaction and handed to
      // the dispatcher after it commits, so a process that dies in between
      // leaves a row nobody ever claimed. Scanning only `sent` left those
      // stranded for ever.
      status: { in: ["pending", "sent"] },
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
      orchestrator: {
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
          senderOrchestrator: {
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
      orchestratorId: mention.orchestratorId,
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
  const senderBot = mention.message.senderOrchestrator ?? null;
  const askedByBot = mention.message.senderUserId == null && senderBot != null;
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

  if (mention.orchestratorId) {
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
      if (winnerKeptRow || lostFinalizeClaim) {
        // Winning worker owns this shell; a lost claim must not discard it.
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

/**
 * A mention of the owner's Soko Bot starts a Soko Bot turn instead of a
 * remote coworker stream. The Thought placeholder is opened here; the
 * control plane mirrors tool progress into it and writes the answer back
 * when the turn settles (see `soko-bot-chat.service.ts`).
 */
async function runSokoBotMentionDispatch(params: {
  mentionId: string;
  mention: {
    message: {
      id: string;
      roomId: string;
      parentMessageId: string | null;
      content: string;
      senderUser: { id: string; name: string | null } | null;
      createdAt: Date;
      room: {
        id: string;
        kind: string;
        name: string | null;
        organizationId: string | null;
      };
    };
    responseMessageId: string | null;
    orchestrator: {
      id: string;
      userId: string;
      archivedAt: Date | null;
    } | null;
    orchestratorId: string | null;
  };
  userId: string;
  workspaceId: string;
  failWithShell: (error: unknown) => Promise<void>;
  askedByBot: boolean;
  chainDepth: number;
}): Promise<void> {
  const {
    mentionId,
    mention,
    userId,
    workspaceId,
    failWithShell,
    askedByBot,
    chainDepth,
  } = params;
  const bot = mention.orchestrator;
  if (!bot || bot.archivedAt) {
    await failWithShell("This Soko Bot is no longer active");
    return;
  }
  // Teammates may talk to the bot in organization rooms; the turn runs as
  // the owner (their bot, their credits) with a read-only ceiling, and the
  // console shows who asked. Personal rooms stay owner-only.
  const isOwner = bot.userId === userId && !askedByBot;
  if (!isOwner && !mention.message.room.organizationId) {
    await failWithShell("Only the owner can message this assistant here");
    return;
  }
  const membership = await prisma.chatRoomOrchestratorMember.findUnique({
    where: {
      roomId_orchestratorId: {
        roomId: mention.message.roomId,
        orchestratorId: bot.id,
      },
    },
    select: { id: true },
  });
  if (!membership) {
    await failWithShell("Soko Bot is no longer a member of this room");
    return;
  }
  const claimed = await claimMentionForDispatch(mentionId);
  if (!claimed) return;

  const startedAtMs = Date.now();
  let placeholderId: string | null = mention.responseMessageId;
  try {
    placeholderId = await publishMentionThoughtPlaceholder({
      placeholderId,
      roomId: mention.message.roomId,
      parentMessageId: mention.message.parentMessageId,
      sourceMessageId: mention.message.id,
      mentionId,
      orchestratorId: bot.id,
      reasoningSteps: [],
      thoughtStartedAtMs: startedAtMs,
    });
  } catch (publishError) {
    console.error("Soko Bot Thought placeholder create failed:", {
      mentionId,
      error: publishError,
    });
  }
  if (!placeholderId) {
    // The create may have committed with its acknowledgement lost, leaving a
    // bubble streaming that this worker never learned the id of. Marking the
    // mention failed without adopting it is how a placeholder outlives every
    // other signal, so look before giving up.
    const committed = await prisma.chatRoomMention.findUnique({
      where: { id: mentionId },
      select: { responseMessageId: true },
    });
    placeholderId = committed?.responseMessageId ?? null;
  }
  if (!placeholderId) {
    await markMentionFailed(mentionId, "Could not open the reply");
    return;
  }

  // From here the caller's closure is stale: it captured the mention's
  // responseMessageId before this placeholder existed, so failing through it
  // would open a second bubble and leave this one streaming for ever — the
  // shape of the "Thinking…" messages that never ended.
  const failPlaceholder = (error: unknown) =>
    failMentionWithCoworkerShell({
      mentionId,
      sourceMessageId: mention.message.id,
      roomId: mention.message.roomId,
      parentMessageId: mention.message.parentMessageId,
      orchestratorId: bot.id,
      existingPlaceholderId: placeholderId,
      error,
    });

  // Directs are the bot's own conversation: the control plane already
  // rehydrates recent turns, so the message goes through as typed. Channel
  // mentions carry the surrounding room context like coworker mentions do.
  const threadRootId = mention.message.parentMessageId;
  // Inside the guard: this reads the room, and a read that throws once left
  // the placeholder above streaming for ever while the mention was marked
  // failed somewhere the reader could not see.
  let message: string;
  try {
    message =
      mention.message.room.kind === "direct"
        ? mention.message.content
        : buildRoomMentionPrompt({
            roomName: mention.message.room.name ?? "chat",
            senderName: mention.message.senderUser?.name ?? "A teammate",
            content: mention.message.content,
            isThreadReply: threadRootId != null,
            contextMessages: await loadRoomContextMessages({
              roomId: mention.message.roomId,
              messageId: mention.message.id,
              createdAt: mention.message.createdAt,
              threadRootId,
            }),
          });
  } catch (error) {
    await failPlaceholder(error);
    return;
  }

  try {
    const accepted = sokoBotControlPlane.startTurn({
      userId: bot.userId,
      workspaceId,
      clientTurnId: `chat:${mentionId}`,
      message: isOwner
        ? message
        : `${mention.message.senderUser?.name ?? "A teammate"} (a teammate, not your owner) asked:\n${message}`,
      source: "CHAT",
      chat: {
        mentionId,
        responseMessageId: placeholderId,
        requestedByUserId: isOwner && !askedByBot ? null : userId,
        askedByBot,
        chainDepth,
      },
    });
    let acceptTimer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      accepted,
      new Promise<never>((_resolve, reject) => {
        acceptTimer = setTimeout(
          () =>
            reject(new Error("Soko Bot took too long to accept the message")),
          SOKO_BOT_ACCEPT_TIMEOUT_MS,
        );
      }),
    ]).finally(() => {
      if (acceptTimer) clearTimeout(acceptTimer);
    });
    if (
      result.reconciliationLeaseToken &&
      (result.status === "STARTING" || result.status === "RUNNING")
    ) {
      await sokoBotControlPlane.reconcileTurn(
        result.turnId,
        undefined,
        result.reconciliationLeaseToken,
      );
    }
  } catch (error) {
    await failPlaceholder(error);
  }
}
