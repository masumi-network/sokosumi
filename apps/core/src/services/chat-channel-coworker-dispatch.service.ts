import type { SokosumiProviderCallOptions } from "@sokosumi/ai-provider";
import { coworkerTextLooksLikeAgentError } from "@sokosumi/ai-provider";
import { generateText } from "ai";

import prisma from "@/lib/db/prisma";
import { getSokosumiProvider } from "@/lib/sokosumi-ai-provider";
import { createCoworkerConversation } from "@/routes/v1/chat/coworker-conversation";

const CHANNEL_COWORKER_TIMEOUT_MS = 90_000;

/** How many prior messages the coworker sees as conversation context. */
const CHANNEL_CONTEXT_MESSAGE_LIMIT = 10;
/** Per-message cap inside the context block so one wall of text cannot eat the prompt. */
const CHANNEL_CONTEXT_MESSAGE_MAX_CHARS = 500;

export interface ChannelContextMessage {
  senderName: string;
  isCoworker: boolean;
  content: string;
}

function formatContextLine(message: ChannelContextMessage): string {
  const flattened = message.content.replace(/\s+/g, " ").trim();
  const truncated =
    flattened.length > CHANNEL_CONTEXT_MESSAGE_MAX_CHARS
      ? `${flattened.slice(0, CHANNEL_CONTEXT_MESSAGE_MAX_CHARS)}…`
      : flattened;
  const senderLabel = message.isCoworker
    ? `${message.senderName} (AI coworker)`
    : message.senderName;
  return `- ${senderLabel}: ${truncated}`;
}

/**
 * Prompt sent to a coworker for a channel mention or thread reply. The
 * CONTEXT block carries the recent messages the coworker never saw (it only
 * receives what is addressed to it), oldest first. Nothing in it is secret —
 * it is the same channel history the humans in the channel can read.
 */
export function buildChannelMentionPrompt(params: {
  channelName: string;
  senderName: string;
  content: string;
  isThreadReply: boolean;
  contextMessages: readonly ChannelContextMessage[];
}): string {
  const action = params.isThreadReply
    ? "replied to a thread you are part of"
    : "mentioned you";
  const messageBlock = `${params.senderName} ${action} in #${params.channelName}:\n\n${params.content}`;

  if (params.contextMessages.length === 0) {
    return messageBlock;
  }

  const contextLines = params.contextMessages.map(formatContextLine);
  return `CONTEXT (last ${params.contextMessages.length} messages in #${params.channelName}):\n${contextLines.join("\n")}\n\n${messageBlock}`;
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
  await prisma.chatChannelMention
    .updateMany({
      where: { id: mentionId, status: { not: "responded" } },
      data: {
        status: "failed",
        error: errorMessage(error).slice(0, 500),
      },
    })
    .catch((updateError) => {
      console.error("Failed to mark channel mention as failed:", updateError);
    });
}

/**
 * Clients poll a mention until it reaches a terminal state, so any escape from
 * the dispatch flow without marking the row pins them to an unbounded poll.
 * This is the single funnel that guarantees termination.
 */
export async function dispatchChatChannelMention(
  mentionId: string,
): Promise<void> {
  try {
    await runChatChannelMentionDispatch(mentionId);
  } catch (error) {
    console.error("Channel coworker dispatch failed:", { mentionId, error });
    await markMentionFailed(mentionId, error);
  }
}

async function runChatChannelMentionDispatch(mentionId: string): Promise<void> {
  const mention = await prisma.chatChannelMention.findUnique({
    where: { id: mentionId },
    include: {
      coworker: {
        select: {
          id: true,
          slug: true,
          name: true,
          baseURL: true,
          archivedAt: true,
          isWhitelisted: true,
          capabilities: true,
        },
      },
      message: {
        include: {
          channel: {
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

  const coworker = mention.coworker;
  if (
    coworker.archivedAt ||
    !coworker.isWhitelisted ||
    !coworker.capabilities.includes("chat") ||
    !coworker.baseURL?.trim()
  ) {
    await markMentionFailed(mentionId, "Coworker chat is not available");
    return;
  }

  // Fail closed when the human sender row was deleted (SetNull): billing /
  // provider auth as the channel creator would attribute cost to the wrong user.
  const userId = mention.message.senderUserId;
  if (!userId) {
    await markMentionFailed(mentionId, "Mention sender is no longer available");
    return;
  }

  // Claim before any provider work so concurrent dispatches cannot both run
  // generateText. Only `pending` → `sent` wins; losers exit quietly.
  const claimed = await prisma.chatChannelMention.updateMany({
    where: { id: mentionId, status: "pending" },
    data: {
      status: "sent",
      error: null,
    },
  });
  if (claimed.count === 0) {
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
    const priorThreadMention = await prisma.chatChannelMention.findFirst({
      where: {
        coworkerId: coworker.id,
        providerConversationId: { not: null },
        message: {
          channelId: mention.message.channelId,
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
        sokosumiOrganizationId: mention.message.channel.organizationId,
        coworkerSlug: coworker.slug,
        sokosumiConversationId: mention.message.id,
      });

  await prisma.chatChannelMention.update({
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
    sokosumiOrganizationId: mention.message.channel.organizationId,
    providerConversationId: providerConversation.id,
    onResponseStarted: (responseId: string) => {
      providerResponseId = responseId;
    },
  };

  // The coworker only ever receives what is addressed to it, so hand it the
  // surrounding conversation: the last messages of the thread it is replying
  // in, or of the channel for a top-level mention (oldest first).
  const contextRows = await prisma.chatChannelMessage.findMany({
    where: {
      channelId: mention.message.channelId,
      id: { not: mention.message.id },
      createdAt: { lte: mention.message.createdAt },
      ...(threadRootId
        ? { OR: [{ id: threadRootId }, { parentMessageId: threadRootId }] }
        : // Top-level mentions should not pull thread replies into CONTEXT.
          { parentMessageId: null }),
    },
    orderBy: { createdAt: "desc" },
    take: CHANNEL_CONTEXT_MESSAGE_LIMIT,
    select: {
      content: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
    },
  });

  const contextMessages: ChannelContextMessage[] = contextRows
    .reverse()
    .map((row) => ({
      senderName:
        row.senderCoworker?.name ?? row.senderUser?.name ?? "Unknown sender",
      isCoworker: row.senderCoworker != null,
      content: row.content,
    }));

  const prompt = buildChannelMentionPrompt({
    channelName: mention.message.channel.name,
    senderName,
    content: mention.message.content,
    isThreadReply: threadRootId != null,
    contextMessages,
  });

  // Bounds the coworker call: without it a stalled upstream keeps the mention
  // non-terminal forever. Aborting throws, which the caller turns into failed.
  const { text } = await generateText({
    model: getSokosumiProvider()(null),
    messages: [{ role: "user", content: prompt }],
    abortSignal: AbortSignal.timeout(CHANNEL_COWORKER_TIMEOUT_MS),
    providerOptions: {
      sokosumi: providerOptions,
    } as unknown as Parameters<typeof generateText>[0]["providerOptions"],
  });

  const responseText = text.trim();
  if (!responseText || coworkerTextLooksLikeAgentError(responseText)) {
    await markMentionFailed(
      mentionId,
      responseText || "Coworker returned an empty response",
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    const responseMessage = await tx.chatChannelMessage.create({
      data: {
        channelId: mention.message.channelId,
        parentMessageId: mention.message.parentMessageId,
        senderCoworkerId: coworker.id,
        content: responseText,
        metadata: {
          in_reply_to_message_id: mention.message.id,
          mention_id: mention.id,
        },
      },
    });

    await tx.chatChannelMention.update({
      where: { id: mention.id },
      data: {
        status: "responded",
        error: null,
        providerResponseId,
        responseMessageId: responseMessage.id,
      },
    });

    await tx.chatChannel.update({
      where: { id: mention.message.channelId },
      data: { updatedAt: new Date() },
    });
  });
}
