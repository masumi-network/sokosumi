import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

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
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function persistAssistantFromAiSdk(params: {
  conversationId: string;
  userId: string;
  text: string;
  responsesApiResponseId: string | null;
  reasoning?: unknown;
  thoughtTiming?: { startedAtMs: number; endedAtMs: number };
}): Promise<void> {
  const {
    conversationId,
    userId,
    text,
    responsesApiResponseId,
    reasoning,
    thoughtTiming,
  } = params;
  const reasoningSteps = reasoningPartsToMetadata(reasoning);
  if (!text.trim() && !reasoningSteps?.length) {
    return;
  }

  const conv = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId,
      archivedAt: null,
    },
    select: { id: true, metadata: true },
  });
  if (!conv) {
    return;
  }

  let responseId = responsesApiResponseId;
  if (!responseId && conv.metadata) {
    const meta = conv.metadata as Record<string, unknown>;
    const pending = meta.pending_responses_api_response_id;
    if (typeof pending === "string" && pending.length > 0) {
      responseId = pending;
    }
  }

  if (responseId) {
    const existing = await prisma.conversationMessage.findFirst({
      where: {
        conversationId: conv.id,
        responsesApiResponseId: responseId,
      },
      select: { id: true },
    });
    if (existing) {
      return;
    }
    try {
      await prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          role: "assistant",
          contentType: "output_text",
          contentText: text,
          responsesApiResponseId: responseId,
          metadata: buildAssistantMessageMetadata(
            reasoningSteps,
            thoughtTiming,
          ),
        },
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        return;
      }
      throw error;
    }
    return;
  }

  await prisma.conversationMessage.create({
    data: {
      conversationId: conv.id,
      role: "assistant",
      contentType: "output_text",
      contentText: text,
      metadata: buildAssistantMessageMetadata(reasoningSteps, thoughtTiming),
    },
  });
}
