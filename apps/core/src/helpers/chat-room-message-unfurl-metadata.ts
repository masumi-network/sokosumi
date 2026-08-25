import type { ChatRoomMessageUnfurl } from "@/schemas/chat-room.schema";

export const REMOVED_UNFURL_URLS_METADATA_KEY = "removedUnfurlUrls";

/**
 * Replace `metadata.unfurls` from the latest scrape while preserving
 * quote / membership / other keys. Empty scrape removes the unfurls key.
 */
export function mergeUnfurlsIntoMessageMetadata(
  existing: unknown,
  unfurls: readonly ChatRoomMessageUnfurl[],
): Record<string, unknown> | null {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  if (unfurls.length === 0) {
    delete base.unfurls;
  } else {
    base.unfurls = [...unfurls];
  }

  return Object.keys(base).length > 0 ? base : null;
}

export function readRemovedUnfurlUrlsFromMetadata(
  metadata: Record<string, unknown> | null,
): string[] {
  const raw = metadata?.[REMOVED_UNFURL_URLS_METADATA_KEY];
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  const urls: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.length > 0) {
      urls.push(entry);
    }
  }
  return urls;
}

export function pruneRemovedUnfurlUrls(
  removedUrls: readonly string[],
  candidateUrls: readonly string[],
): string[] {
  if (removedUrls.length === 0) {
    return [];
  }
  const candidates = new Set(candidateUrls);
  return removedUrls.filter((url) => candidates.has(url));
}

export function applyRemovedUnfurlToMetadata(
  existing: unknown,
  url: string,
): {
  status: "removed" | "already_removed" | "not_found";
  metadata: Record<string, unknown> | null;
} {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const storedCards = parseUnfurlCardsFromMetadata(base);
  const removedUrls = readRemovedUnfurlUrlsFromMetadata(base);
  const isKnown =
    storedCards.some((card) => card.url === url) || removedUrls.includes(url);

  if (!isKnown) {
    return {
      status: "not_found",
      metadata: Object.keys(base).length > 0 ? base : null,
    };
  }

  const remainingCards = storedCards.filter((card) => card.url !== url);
  const nextRemoved = removedUrls.includes(url)
    ? removedUrls
    : [...removedUrls, url];
  const alreadyGone =
    remainingCards.length === storedCards.length &&
    nextRemoved.length === removedUrls.length;

  if (alreadyGone) {
    return {
      status: "already_removed",
      metadata: Object.keys(base).length > 0 ? base : null,
    };
  }

  if (remainingCards.length === 0) {
    delete base.unfurls;
  } else {
    base.unfurls = remainingCards;
  }
  base[REMOVED_UNFURL_URLS_METADATA_KEY] = nextRemoved;

  return {
    status: "removed",
    metadata: Object.keys(base).length > 0 ? base : null,
  };
}

export function publicChatRoomMessageMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }
  const { [REMOVED_UNFURL_URLS_METADATA_KEY]: _removed, ...rest } = metadata;
  const visibleUnfurls = readUnfurlsFromMetadata(metadata);
  if (visibleUnfurls) {
    rest.unfurls = visibleUnfurls;
  } else {
    delete rest.unfurls;
  }
  return Object.keys(rest).length > 0 ? rest : null;
}

export function readUnfurlsFromMetadata(
  metadata: Record<string, unknown> | null,
): ChatRoomMessageUnfurl[] | null {
  const parsed = parseUnfurlCardsFromMetadata(metadata);
  if (parsed.length === 0) {
    return null;
  }
  const removed = new Set(readRemovedUnfurlUrlsFromMetadata(metadata));
  const visible =
    removed.size === 0
      ? parsed
      : parsed.filter((card) => !removed.has(card.url));
  return visible.length > 0 ? visible : null;
}

function parseUnfurlCardsFromMetadata(
  metadata: Record<string, unknown> | null,
): ChatRoomMessageUnfurl[] {
  const raw = metadata?.unfurls;
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const parsed: ChatRoomMessageUnfurl[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.url !== "string" ||
      typeof candidate.title !== "string" ||
      candidate.title.trim().length === 0
    ) {
      continue;
    }
    if (
      candidate.description !== null &&
      typeof candidate.description !== "string"
    ) {
      continue;
    }
    if (candidate.imageUrl !== null && typeof candidate.imageUrl !== "string") {
      continue;
    }
    if (candidate.siteName !== null && typeof candidate.siteName !== "string") {
      continue;
    }
    parsed.push({
      url: candidate.url,
      title: candidate.title,
      description: (candidate.description as string | null) ?? null,
      imageUrl: (candidate.imageUrl as string | null) ?? null,
      siteName: (candidate.siteName as string | null) ?? null,
    });
    if (parsed.length >= 3) {
      break;
    }
  }

  return parsed;
}
