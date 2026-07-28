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

export async function persistAssistantToChatRoom(params: {
  roomId: string;
  senderCoworkerId: string;
  contentText: string;
  responsesApiResponseId?: string | null;
  reasoning?: unknown;
  thoughtTiming?: { startedAtMs: number; endedAtMs: number };
  uiParts?: PersistedChatUiPart[];
}): Promise<{ id: string }> {
  const {
    roomId,
    senderCoworkerId,
    contentText,
    responsesApiResponseId,
    reasoning,
    thoughtTiming,
    uiParts,
  } = params;
  const reasoningSteps = reasoningPartsToMetadata(reasoning);
  const hasUiParts = uiParts != null && uiParts.length > 0;
  if (!contentText.trim() && !reasoningSteps?.length && !hasUiParts) {
    throw new Error("Cannot persist empty assistant chat room message");
  }

  const responseId =
    typeof responsesApiResponseId === "string" &&
    responsesApiResponseId.length > 0
      ? responsesApiResponseId
      : null;

  if (responseId) {
    const existing = await prisma.chatRoomMessage.findFirst({
      where: {
        roomId,
        metadata: {
          path: ["responses_api_response_id"],
          equals: responseId,
        },
      },
      select: { id: true },
    });
    if (existing) {
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
    const created = await prisma.chatRoomMessage.create({
      data: {
        roomId,
        senderCoworkerId,
        senderUserId: null,
        content: contentText,
        metadata,
      },
      select: { id: true },
    });
    return { id: created.id };
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      const existing = responseId
        ? await prisma.chatRoomMessage.findFirst({
            where: {
              roomId,
              metadata: {
                path: ["responses_api_response_id"],
                equals: responseId,
              },
            },
            select: { id: true },
          })
        : null;
      if (existing) {
        return { id: existing.id };
      }
    }
    throw error;
  }
}

export async function persistUserMessageToChatRoom(params: {
  roomId: string;
  senderUserId: string;
  contentText: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const { roomId, senderUserId, contentText, metadata } = params;

  const created = await prisma.chatRoomMessage.create({
    data: {
      roomId,
      senderUserId,
      senderCoworkerId: null,
      content: contentText,
      metadata,
    },
    select: { id: true },
  });

  return { id: created.id };
}
