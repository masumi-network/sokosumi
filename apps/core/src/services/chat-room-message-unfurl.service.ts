import { selectUnfurlCandidateUrls } from "@sokosumi/utils";

import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { scrapeUnfurlCards } from "@/lib/chat-unfurl-scrape";
import prisma from "@/lib/db/prisma";
import { mergeUnfurlsIntoMessageMetadata } from "@/routes/v1/chats/rooms/helpers";

export interface ScheduleChatRoomMessageUnfurlsResult {
  messageId: string;
  attempted: number;
  persisted: number;
}

/**
 * Full unfurl pipeline for one message. Safe to call from `waitUntil`.
 * Never throws to the caller for scrape/SSRF/parse failures — those omit
 * silently. Unexpected infra errors are logged and swallowed.
 */
export async function scheduleChatRoomMessageUnfurls(
  messageId: string,
): Promise<ScheduleChatRoomMessageUnfurlsResult> {
  const empty: ScheduleChatRoomMessageUnfurlsResult = {
    messageId,
    attempted: 0,
    persisted: 0,
  };

  try {
    const message = await prisma.chatRoomMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        content: true,
        deletedAt: true,
        editedAt: true,
        metadata: true,
      },
    });

    if (!message || message.deletedAt != null) {
      return empty;
    }

    const contentSnapshot = message.content;
    const urls = selectUnfurlCandidateUrls(contentSnapshot);
    const cards = await scrapeUnfurlCards(urls);

    const latest = await prisma.chatRoomMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        content: true,
        deletedAt: true,
        metadata: true,
      },
    });

    if (!latest || latest.deletedAt != null) {
      return { messageId, attempted: urls.length, persisted: 0 };
    }

    if (latest.content !== contentSnapshot) {
      return { messageId, attempted: urls.length, persisted: 0 };
    }

    const metadata = mergeUnfurlsIntoMessageMetadata(latest.metadata, cards);

    await prisma.chatRoomMessage.update({
      where: { id: messageId },
      data: { metadata },
    });

    await publishChatRoomMessageRealtimeById(messageId);

    return {
      messageId,
      attempted: urls.length,
      persisted: cards.length,
    };
  } catch (error) {
    console.warn(
      `[chat-unfurl] scheduleChatRoomMessageUnfurls failed for ${messageId}`,
      error,
    );
    return empty;
  }
}
