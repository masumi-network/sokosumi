import { invalidateChatRoomMessageReaders } from "@/helpers/chat-room-message-created-effects";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { reasoningPartsToMetadata } from "@/helpers/persist-assistant-to-chat-room";
import prisma from "@/lib/db/prisma";

import { markMentionFailed } from "./chat-room-mention-state";

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

export async function consumeMentionProviderStream(
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

export async function publishMentionThoughtPlaceholder(params: {
  placeholderId: string | null;
  roomId: string;
  parentMessageId: string | null;
  sourceMessageId: string;
  mentionId: string;
  coworkerId?: string | null;
  sokoBotId?: string | null;
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
      where: {
        id: params.placeholderId,
        content: "",
        mentionResponseFor: { status: { in: ["pending", "sent"] } },
      },
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
        senderSokoBotId: params.sokoBotId ?? null,
        content: "",
        metadata,
      },
    });
    await tx.chatRoomMention.update({
      where: { id: params.mentionId, status: { not: "responded" } },
      data: { responseMessageId: row.id },
    });
    // The placeholder already counts toward unreadCount; without the bump the
    // web read overlay keeps the room painted read until the final reply lands.
    await tx.chatRoom.update({
      where: { id: params.roomId },
      data: { updatedAt: new Date() },
    });
    return row;
  });
  await invalidateChatRoomMessageReaders({
    roomId: params.roomId,
    authorUserId: null,
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

export async function discardMentionThoughtPlaceholder(
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
export async function failMentionThoughtPlaceholder(params: {
  placeholderId: string | null;
  sourceMessageId: string;
  mentionId: string;
  onlyWhenFailed?: boolean;
}): Promise<void> {
  if (!params.placeholderId) return;

  // A retry can complete after a caller reads the mention. Match at write
  // time, and never erase nonempty final content or a responded mention.
  const where = {
    id: params.placeholderId,
    content: "",
    mentionResponseFor: {
      status: params.onlyWhenFailed ? "failed" : { not: "responded" },
    },
  };
  const updateShell = () =>
    prisma.chatRoomMessage.updateMany({
      where,
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: params.sourceMessageId,
          mention_id: params.mentionId,
          mention_failed: true,
        },
      },
    });
  // Retry a failed write once, then remove only the same unfinished shell.
  // A lost match returns zero and never enters the retry/delete fallback.
  const changed = await updateShell().catch(() =>
    updateShell().catch(() =>
      prisma.chatRoomMessage.deleteMany({ where }).catch(() => ({ count: 0 })),
    ),
  );
  if (changed.count === 0) return;
  await publishChatRoomMessageRealtimeById(params.placeholderId, "update");
}

/** Pre-claim fail still needs a coworker bubble; parent has no mention footer. */
export async function failMentionWithCoworkerShell(params: {
  mentionId: string;
  sourceMessageId: string;
  roomId: string;
  parentMessageId: string | null;
  coworkerId?: string | null;
  sokoBotId?: string | null;
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
        sokoBotId: params.sokoBotId,
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
