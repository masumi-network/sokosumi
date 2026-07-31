import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";

import { chatRoomMessagesToUiMessages } from "@/helpers/chat-room-messages-to-ui-messages";
import prisma from "@/lib/db/prisma";
import {
  CoworkerConversationError,
  createCoworkerConversation,
} from "@/routes/v1/chats/stream/coworker-conversation";
import {
  buildRoomMentionPrompt,
  type RoomContextMessage,
} from "@/services/chat-room-coworker-dispatch.service";

/** Metadata key for a thread-scoped remote conversation (not room.providerConversationId). */
export const THREAD_PROVIDER_CONVERSATION_ID_KEY =
  "thread_provider_conversation_id";

/** Match channel mention dispatch context window. */
const THREAD_CONTEXT_MESSAGE_LIMIT = 10;

function readThreadProviderConversationId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[
    THREAD_PROVIDER_CONVERSATION_ID_KEY
  ];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mergeMetadataWithThreadConversationId(
  metadata: unknown,
  providerConversationId: string,
): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  return {
    ...base,
    [THREAD_PROVIDER_CONVERSATION_ID_KEY]: providerConversationId,
  };
}

/**
 * Creates or reuses a remote coworker conversation scoped to a thread root.
 * Stored on the parent message metadata so top-level room conversation context
 * does not bleed into thread replies (and vice versa).
 */
export async function ensureThreadProviderConversation(options: {
  roomId: string;
  parentMessageId: string;
  userId: string;
  organizationId: string | null;
  coworkerSlug: string;
  responsesApiBaseUrl: string;
}): Promise<{ providerConversationId: string; justCreated: boolean }> {
  const parent = await prisma.chatRoomMessage.findFirst({
    where: {
      id: options.parentMessageId,
      roomId: options.roomId,
      parentMessageId: null,
    },
    select: { id: true, metadata: true },
  });
  if (!parent) {
    throw new CoworkerConversationError(
      "Thread parent message not found for provider conversation",
      400,
    );
  }

  const existingId = readThreadProviderConversationId(parent.metadata);
  if (existingId) {
    return { providerConversationId: existingId, justCreated: false };
  }

  const created = await createCoworkerConversation({
    responsesApiBaseUrl: options.responsesApiBaseUrl,
    sokosumiUserId: options.userId,
    sokosumiOrganizationId: options.organizationId,
    coworkerSlug: options.coworkerSlug,
    // Correlate remote conversation to the thread root, not the room.
    sokosumiConversationId: options.parentMessageId,
  });

  const nextMetadata = mergeMetadataWithThreadConversationId(
    parent.metadata,
    created.id,
  );

  await prisma.chatRoomMessage.update({
    where: { id: options.parentMessageId },
    data: { metadata: nextMetadata },
  });

  // Concurrent writers may overwrite — prefer whatever is stored now.
  const after = await prisma.chatRoomMessage.findFirst({
    where: { id: options.parentMessageId, roomId: options.roomId },
    select: { metadata: true },
  });
  const storedId = readThreadProviderConversationId(after?.metadata);
  if (!storedId) {
    throw new CoworkerConversationError(
      "Could not persist coworker provider conversation id on thread parent",
      503,
    );
  }
  return {
    providerConversationId: storedId,
    justCreated: storedId === created.id,
  };
}

/**
 * Build model messages for a room-stream thread reply.
 *
 * Loads thread root + siblings (oldest first). Conversation mode only sends
 * the last turn to the remote API, so the first AI turn in a fresh thread
 * conversation embeds prior thread context via `buildRoomMentionPrompt`
 * (same discipline as channel mention dispatch).
 */
export async function buildRoomStreamThreadModelMessages(options: {
  roomId: string;
  parentMessageId: string;
  roomName: string;
  senderName: string;
  lastUserMessageText: string;
}): Promise<{ modelMessages: ModelMessage[]; uiMessages: UIMessage[] }> {
  const rows = await prisma.chatRoomMessage.findMany({
    where: {
      roomId: options.roomId,
      OR: [
        { id: options.parentMessageId },
        { parentMessageId: options.parentMessageId },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: THREAD_CONTEXT_MESSAGE_LIMIT + 1,
    select: {
      id: true,
      content: true,
      senderUserId: true,
      senderCoworkerId: true,
      metadata: true,
      createdAt: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
    },
  });

  const uiMessages = chatRoomMessagesToUiMessages(rows);
  const hasPriorAssistant = rows.some(
    (row, index) => row.senderCoworkerId != null && index < rows.length - 1,
  );

  if (!hasPriorAssistant) {
    const contextMessages: RoomContextMessage[] = rows
      .slice(0, -1)
      .map((row) => ({
        senderName:
          row.senderCoworker?.name ?? row.senderUser?.name ?? "Unknown sender",
        isCoworker: row.senderCoworkerId != null,
        content: row.content,
      }));
    const prompt = buildRoomMentionPrompt({
      roomName: options.roomName,
      senderName: options.senderName,
      content: options.lastUserMessageText,
      isThreadReply: true,
      contextMessages,
    });
    const modelMessages: ModelMessage[] = [{ role: "user", content: prompt }];
    return { modelMessages, uiMessages };
  }

  const modelMessages = await convertToModelMessages(
    uiMessages.map(({ id: _id, ...rest }) => rest),
  );
  return { modelMessages, uiMessages };
}
