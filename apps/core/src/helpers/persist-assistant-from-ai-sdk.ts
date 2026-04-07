import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";

export async function persistAssistantFromAiSdk(params: {
  conversationId: string;
  userId: string;
  text: string;
  responsesApiResponseId: string | null;
}): Promise<void> {
  const { conversationId, userId, text, responsesApiResponseId } = params;
  if (!text.trim()) {
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
    const existing = await prisma.conversationItem.findFirst({
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
      await prisma.conversationItem.create({
        data: {
          conversationId: conv.id,
          role: "assistant",
          contentType: "output_text",
          contentText: text,
          responsesApiResponseId: responseId,
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

  await prisma.conversationItem.create({
    data: {
      conversationId: conv.id,
      role: "assistant",
      contentType: "output_text",
      contentText: text,
    },
  });
}
