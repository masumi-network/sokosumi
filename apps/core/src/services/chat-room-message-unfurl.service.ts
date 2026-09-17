import { selectUnfurlCandidateUrls } from "@sokosumi/utils";
import {
  deleteChatRoomMessageMetadataKeys,
  mergeChatRoomMessageMetadataKeys,
} from "@/helpers/chat-room-message-metadata-patch";
import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";
import {
  asMetadataRecord,
  pruneRemovedUnfurlUrls,
  REMOVED_UNFURL_URLS_METADATA_KEY,
  readRemovedUnfurlUrlsFromMetadata,
  readUnfurlsFromMetadata,
} from "@/helpers/chat-room-message-unfurl-metadata";
import { scrapeUnfurlCards } from "@/lib/chat-unfurl-scrape";
import {
  deleteChatRoomUnfurlSnapshotsIfOwned,
  snapshotChatRoomUnfurlImage,
} from "@/lib/chat-unfurl-snapshot";
import prisma from "@/lib/db/prisma";
import type { ChatRoomMessageUnfurlCard } from "@/lib/open-graph-html";

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
  // Snapshots uploaded by this run; deleted again on every abandon path.
  let roomId: string | null = null;
  let freshSnapshots: Array<string | null> = [];
  const discardFreshSnapshots = async () => {
    if (roomId === null) return;
    await deleteChatRoomUnfurlSnapshotsIfOwned(
      freshSnapshots,
      roomId,
      messageId,
    );
  };

  try {
    const message = await prisma.chatRoomMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        roomId: true,
        content: true,
        deletedAt: true,
        editedAt: true,
        metadata: true,
      },
    });

    if (!message || message.deletedAt != null) {
      return empty;
    }
    roomId = message.roomId;

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
    const cards = await snapshotCardImages(
      await scrapeUnfurlCards(urlsToScrape),
      roomId,
      messageId,
    );
    freshSnapshots = cards.map((card) => card.imageUrl);

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
      await discardFreshSnapshots();
      return { messageId, attempted: urlsToScrape.length, persisted: 0 };
    }

    if (latest.content !== contentSnapshot) {
      await discardFreshSnapshots();
      return { messageId, attempted: urlsToScrape.length, persisted: 0 };
    }

    const previousSnapshots = (
      readUnfurlsFromMetadata(asMetadataRecord(latest.metadata)) ?? []
    ).map((card) => card.imageUrl);

    const removedUrls = pruneRemovedUnfurlUrls(
      readRemovedUnfurlUrlsFromMetadata(asMetadataRecord(latest.metadata)),
      candidateUrls,
    );
    const visibleCards = cards.filter(
      (card) => !removedUrls.includes(card.url),
    );
    // A card removed while the scrape ran never reaches metadata, so its
    // snapshot goes now; the remove route cannot see it.
    await deleteChatRoomUnfurlSnapshotsIfOwned(
      cards
        .filter((card) => !visibleCards.includes(card))
        .map((card) => card.imageUrl),
      roomId,
      messageId,
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
      await discardFreshSnapshots();
      return { messageId, attempted: urlsToScrape.length, persisted: 0 };
    }

    await publishChatRoomMessageRealtimeById(messageId, "unfurl");
    await deleteChatRoomUnfurlSnapshotsIfOwned(
      previousSnapshots.filter((url) => !freshSnapshots.includes(url)),
      roomId,
      messageId,
    );

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
    await discardFreshSnapshots().catch(() => undefined);
    return empty;
  }
}

/**
 * Store each card's preview image under the message (ADR 0031). A card whose
 * snapshot fails keeps its source URL.
 */
function snapshotCardImages(
  cards: ChatRoomMessageUnfurlCard[],
  roomId: string,
  messageId: string,
): Promise<ChatRoomMessageUnfurlCard[]> {
  // In parallel so the message stays within one download budget, not one per card.
  return Promise.all(
    cards.map(async (card) => {
      if (!card.imageUrl) return card;
      const stored = await snapshotChatRoomUnfurlImage({
        roomId,
        messageId,
        imageUrl: card.imageUrl,
      });
      return stored ? { ...card, imageUrl: stored } : card;
    }),
  );
}
