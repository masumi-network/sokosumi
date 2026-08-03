import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import type { PersistedChatUiPart } from "./message-content";

function reasoningPartsToMetadata(
  reasoning: unknown,
): Array<{ type: string; text: string }> | undefined {
  if (!Array.isArray(reasoning) || reasoning.length === 0) {
    return undefined;
  }
  const out: Array<{ type: string; text: string }> = [];
  for (const part of reasoning) {
    if (!part || typeof part !== "object") continue;
    const rec = part as Record<string, unknown>;
    const rawText = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!rawText) continue;
    const type =
      typeof rec.type === "string" && rec.type.length > 0
        ? rec.type
        : "reasoning";
    out.push({ type, text: rawText });
  }
  return out.length > 0 ? out : undefined;
}

function buildAssistantMessageMetadata(
  reasoningSteps: Array<{ type: string; text: string }> | undefined,
  thoughtTiming: { startedAtMs: number; endedAtMs: number } | undefined,
  uiParts: PersistedChatUiPart[] | undefined,
  responsesApiResponseId: string | null | undefined,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (reasoningSteps && reasoningSteps.length > 0) {
    out.reasoning = reasoningSteps;
  }
  if (
    thoughtTiming != null &&
    thoughtTiming.startedAtMs > 0 &&
    thoughtTiming.endedAtMs >= thoughtTiming.startedAtMs
  ) {
    out.thought_timing_ms = {
      start: thoughtTiming.startedAtMs,
      end: thoughtTiming.endedAtMs,
    };
  }
  if (uiParts && uiParts.length > 0) {
    out.ui_message_v1 = {
      parts: uiParts,
    };
  }
  if (typeof responsesApiResponseId === "string" && responsesApiResponseId) {
    out.responses_api_response_id = responsesApiResponseId;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function findAssistantByResponsesApiResponseId(
  roomId: string,
  responsesApiResponseId: string,
): Promise<{ id: string } | null> {
  return prisma.chatRoomMessage.findUnique({
    where: {
      roomId_responsesApiResponseId: {
        roomId,
        responsesApiResponseId,
      },
    },
    select: { id: true },
  });
}

async function findUserByClientMessageId(
  roomId: string,
  clientMessageId: string,
): Promise<{ id: string } | null> {
  return prisma.chatRoomMessage.findUnique({
    where: {
      roomId_clientMessageId: {
        roomId,
        clientMessageId,
      },
    },
    select: { id: true },
  });
}

/**
 * Persists an assistant turn to `chat_room_message`.
 * Callers must not pass empty content (no text, reasoning, or ui parts) — throws if empty.
 *
 * When `responsesApiResponseId` is set, DB unique `(roomId, responsesApiResponseId)`
 * guarantees at most one assistant row under concurrent writers (Redis lock is
 * happy-path only). Soft lookup + P2002 recovery return the existing id.
 * Uniqueness is room-scoped (not per coworker), matching SOK-658.
 */
export async function persistAssistantToChatRoom(params: {
  roomId: string;
  senderCoworkerId: string;
  contentText: string;
  responsesApiResponseId?: string | null;
  reasoning?: unknown;
  thoughtTiming?: { startedAtMs: number; endedAtMs: number };
  uiParts?: PersistedChatUiPart[];
  /** Thread root id when this turn is a thread reply. */
  parentMessageId?: string | null;
}): Promise<{ id: string }> {
  const {
    roomId,
    senderCoworkerId,
    contentText,
    responsesApiResponseId,
    reasoning,
    thoughtTiming,
    uiParts,
    parentMessageId,
  } = params;
  const reasoningSteps = reasoningPartsToMetadata(reasoning);
  const hasUiParts = uiParts != null && uiParts.length > 0;
  if (!contentText.trim() && !reasoningSteps?.length && !hasUiParts) {
    throw new Error("Cannot persist empty assistant chat room message");
  }

  const trimmedResponseId =
    typeof responsesApiResponseId === "string"
      ? responsesApiResponseId.trim()
      : "";
  const responseId = trimmedResponseId.length > 0 ? trimmedResponseId : null;

  if (responseId) {
    const existing = await findAssistantByResponsesApiResponseId(
      roomId,
      responseId,
    );
    if (existing) {
      await publishChatRoomMessageRealtimeById(existing.id);
      return { id: existing.id };
    }
  }

  const metadata = buildAssistantMessageMetadata(
    reasoningSteps,
    thoughtTiming,
    uiParts,
    responseId,
  );

  try {
    const created = await prisma.$transaction(async (tx) => {
      const message = await tx.chatRoomMessage.create({
        data: {
          roomId,
          senderCoworkerId,
          senderUserId: null,
          content: contentText,
          metadata,
          responsesApiResponseId: responseId,
          parentMessageId: parentMessageId ?? null,
        },
        select: { id: true },
      });
      // Sidebar / room list order by activity — keep in sync with stream writes.
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });
      return message;
    });
    await publishChatRoomMessageRealtimeById(created.id);
    return { id: created.id };
  } catch (error) {
    if (!responseId || !isPrismaUniqueViolation(error)) {
      throw error;
    }
    // Interactive tx aborted after failed create — re-read on root client.
    const raced = await findAssistantByResponsesApiResponseId(
      roomId,
      responseId,
    );
    if (raced) {
      await publishChatRoomMessageRealtimeById(raced.id);
      return { id: raced.id };
    }
    throw error;
  }
}

/**
 * Persists a user turn to `chat_room_message`.
 *
 * When `clientMessageId` is set, DB unique `(roomId, clientMessageId)` guarantees
 * at most one user row under concurrent writers (Redis lock is happy-path only).
 * Soft lookup + P2002 recovery return the existing id.
 *
 * Uniqueness is intentionally room-scoped (not per sender): SOK-658 requires one
 * row per client turn id in the room transcript. Client message ids are opaque
 * AI SDK ids; cross-member collisions are not expected.
 */
export async function persistUserMessageToChatRoom(params: {
  roomId: string;
  senderUserId: string;
  contentText: string;
  metadata?: Record<string, unknown>;
  /**
   * AI SDK / client message id. Retries of the same stream turn reuse this so
   * we do not insert duplicate user rows after a failed/aborted stream.
   */
  clientMessageId?: string | null;
  /** Thread root id when this turn is a thread reply. */
  parentMessageId?: string | null;
}): Promise<{ id: string }> {
  const {
    roomId,
    senderUserId,
    contentText,
    metadata,
    clientMessageId,
    parentMessageId,
  } = params;

  const trimmedClientId =
    typeof clientMessageId === "string" ? clientMessageId.trim() : "";
  const clientId = trimmedClientId.length > 0 ? trimmedClientId : null;

  if (clientId) {
    const existing = await findUserByClientMessageId(roomId, clientId);
    if (existing) {
      await publishChatRoomMessageRealtimeById(existing.id);
      return { id: existing.id };
    }
  }

  const mergedMetadata: Record<string, unknown> = {
    ...(metadata ?? {}),
    ...(clientId ? { client_message_id: clientId } : {}),
  };
  const metadataToStore =
    Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const message = await tx.chatRoomMessage.create({
        data: {
          roomId,
          senderUserId,
          senderCoworkerId: null,
          content: contentText,
          metadata: metadataToStore,
          clientMessageId: clientId,
          parentMessageId: parentMessageId ?? null,
        },
        select: { id: true },
      });
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });
      return message;
    });

    await publishChatRoomMessageRealtimeById(created.id);
    return { id: created.id };
  } catch (error) {
    if (!clientId || !isPrismaUniqueViolation(error)) {
      throw error;
    }
    // Interactive tx aborted after failed create — re-read on root client.
    const raced = await findUserByClientMessageId(roomId, clientId);
    if (raced) {
      await publishChatRoomMessageRealtimeById(raced.id);
      return { id: raced.id };
    }
    throw error;
  }
}
