import type { SokosumiProviderCallOptions } from "@sokosumi/ai-provider";
import { coworkerTextLooksLikeAgentError } from "@sokosumi/ai-provider";
import { generateText } from "ai";

import prisma from "@/lib/db/prisma";
import { getSokosumiProvider } from "@/lib/sokosumi-ai-provider";
import { createCoworkerConversation } from "@/routes/v1/chat/coworker-conversation";

const CHANNEL_COWORKER_TIMEOUT_MS = 90_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function markMentionFailed(
  mentionId: string,
  error: unknown,
): Promise<void> {
  await prisma.chatChannelMention
    .update({
      where: { id: mentionId },
      data: {
        status: "failed",
        error: errorMessage(error).slice(0, 500),
      },
    })
    .catch((updateError) => {
      console.error("Failed to mark channel mention as failed:", updateError);
    });
}

export async function dispatchChatChannelMention(
  mentionId: string,
): Promise<void> {
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
              createdByUserId: true,
            },
          },
          senderUser: {
            select: {
              id: true,
              name: true,
            },
          },
          parentMessage: {
            select: {
              content: true,
              senderUser: {
                select: {
                  name: true,
                },
              },
              senderCoworker: {
                select: {
                  name: true,
                },
              },
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

  const userId =
    mention.message.senderUserId ?? mention.message.channel.createdByUserId;
  const senderName = mention.message.senderUser?.name ?? "A teammate";
  const baseURL = coworker.baseURL.trim();
  let providerResponseId: string | null = null;

  try {
    const providerConversation = mention.providerConversationId
      ? { id: mention.providerConversationId }
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
        status: "sent",
        providerConversationId: providerConversation.id,
        error: null,
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

    const threadRoot = mention.message.parentMessage
      ? [
          `Thread root from ${
            mention.message.parentMessage.senderUser?.name ??
            mention.message.parentMessage.senderCoworker?.name ??
            "a teammate"
          }:`,
          mention.message.parentMessage.content,
          "",
        ].join("\n")
      : "";
    const prompt = mention.message.parentMessageId
      ? [
          `${senderName} replied in a thread in #${mention.message.channel.name}:`,
          "",
          `${threadRoot}${senderName}:`,
          mention.message.content,
        ].join("\n")
      : `${senderName} mentioned you in #${mention.message.channel.name}:\n\n${mention.message.content}`;

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
  } catch (error) {
    console.error("Channel coworker dispatch failed:", {
      mentionId,
      coworkerId: coworker.id,
      error,
    });
    await markMentionFailed(mentionId, error);
  }
}
