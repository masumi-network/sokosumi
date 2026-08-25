import { selectUnfurlCandidateUrls } from "@sokosumi/utils";
import {
  deleteChatRoomMessageMetadataKeys,
  mergeChatRoomMessageMetadataKeys,
} from "@/helpers/chat-room-message-metadata-patch";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import { scrapeUnfurlCards } from "@/lib/chat-unfurl-scrape";
import prisma from "@/lib/db/prisma";
import {
  pruneRemovedUnfurlUrls,
  REMOVED_UNFURL_URLS_METADATA_KEY,
  readRemovedUnfurlUrlsFromMetadata,
} from "@/routes/v1/chats/rooms/helpers";

export interface ScheduleChatRoomMessageUnfurlsResult {
  messageId: string;
  attempted: number;
  persisted: number;
}

/**
 * Full unfurl pipeline for one message. Safe to call from `waitUntil`.
 * Never throws to the caller for scrape/SSRF/parse failures — those omit
 * silently. Unexpected infra errors are logged and swallowed.
 *
 * Persists via atomic jsonb key merge/delete so a concurrent writer that sets
 * `thread_provider_conversation_id` (thread coworker stream) is not wiped by
 * a stale read→write of the whole metadata object after scrape latency.
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
    const candidateUrls = selectUnfurlCandidateUrls(contentSnapshot);
    const existingRemoved = readRemovedUnfurlUrlsFromMetadata(
      asMetadataRecord(message.metadata),
    );
    const removedBeforeScrape = pruneRemovedUnfurlUrls(
      existingRemoved,
      candidateUrls,
    );
    if (removedBeforeScrape.length !== existingRemoved.length) {
      if (removedBeforeScrape.length === 0) {
        await deleteChatRoomMessageMetadataKeys({
          messageId,
          keys: [REMOVED_UNFURL_URLS_METADATA_KEY],
          contentMustEqual: contentSnapshot,
        });
      } else {
        await mergeChatRoomMessageMetadataKeys({
          messageId,
          patch: { [REMOVED_UNFURL_URLS_METADATA_KEY]: removedBeforeScrape },
          contentMustEqual: contentSnapshot,
        });
      }
    }
    const urlsToScrape = candidateUrls.filter(
      (url) => !removedBeforeScrape.includes(url),
    );
    const cards = await scrapeUnfurlCards(urlsToScrape);

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
      return { messageId, attempted: urlsToScrape.length, persisted: 0 };
    }

    if (latest.content !== contentSnapshot) {
      return { messageId, attempted: urlsToScrape.length, persisted: 0 };
    }

    const removedUrls = pruneRemovedUnfurlUrls(
      readRemovedUnfurlUrlsFromMetadata(asMetadataRecord(latest.metadata)),
      candidateUrls,
    );
    const visibleCards = cards.filter(
      (card) => !removedUrls.includes(card.url),
    );
    const existingRemovedAtPersist = readRemovedUnfurlUrlsFromMetadata(
      asMetadataRecord(latest.metadata),
    );

    const patch: Record<string, unknown> = {};
    const keysToDelete: string[] = [];
    if (visibleCards.length === 0) {
      keysToDelete.push("unfurls");
    } else {
      patch.unfurls = visibleCards;
    }
    if (removedUrls.length === 0) {
      if (existingRemovedAtPersist.length > 0) {
        keysToDelete.push(REMOVED_UNFURL_URLS_METADATA_KEY);
      }
    } else {
      patch[REMOVED_UNFURL_URLS_METADATA_KEY] = removedUrls;
    }

    let updated = 0;
    if (keysToDelete.length > 0) {
      updated += await deleteChatRoomMessageMetadataKeys({
        messageId,
        keys: keysToDelete,
        contentMustEqual: contentSnapshot,
      });
    }
    if (Object.keys(patch).length > 0) {
      updated += await mergeChatRoomMessageMetadataKeys({
        messageId,
        patch,
        contentMustEqual: contentSnapshot,
      });
    }

    if (updated === 0) {
      return { messageId, attempted: urlsToScrape.length, persisted: 0 };
    }

    await publishChatRoomMessageRealtimeById(messageId, "unfurl");

    return {
      messageId,
      attempted: urlsToScrape.length,
      persisted: visibleCards.length,
    };
  } catch (error) {
    console.warn(
      `[chat-unfurl] scheduleChatRoomMessageUnfurls failed for ${messageId}`,
      error,
    );
    return empty;
  }
}

function asMetadataRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
