import type { HistoryItem } from "@/lib/services/history.service";

export interface HistorySubtitleLookups {
  agentNameById: Record<string, string>;
  bucketDisplayNameBySlug: Record<string, string>;
}

export interface HistorySubtitleLabels {
  noDescription: string;
}

export function createEmptyHistorySubtitleLookups(): HistorySubtitleLookups {
  return {
    agentNameById: {},
    bucketDisplayNameBySlug: {},
  };
}

export function mergeHistorySubtitleLookups(
  current: HistorySubtitleLookups,
  next: HistorySubtitleLookups,
): HistorySubtitleLookups {
  return {
    agentNameById: {
      ...current.agentNameById,
      ...next.agentNameById,
    },
    bucketDisplayNameBySlug: {
      ...current.bucketDisplayNameBySlug,
      ...next.bucketDisplayNameBySlug,
    },
  };
}

export function getHistoryRowSubtitle(
  item: HistoryItem,
  lookups: HistorySubtitleLookups,
  labels: HistorySubtitleLabels,
): string {
  const description = item.description?.trim();
  if (description) return description;

  const fallback = getHistoryRowSubtitleFallback(item, lookups);
  if (fallback && !isSameDisplayText(fallback, item.title)) return fallback;

  return labels.noDescription;
}

function getHistoryRowSubtitleFallback(
  item: HistoryItem,
  lookups: HistorySubtitleLookups,
): string | null {
  switch (item.kind) {
    case "job":
      return lookups.agentNameById[item.agentId]?.trim() || null;
    case "conversation":
      return item.bucketSlug
        ? lookups.bucketDisplayNameBySlug[item.bucketSlug]?.trim() || null
        : null;
    case "task":
      return null;
  }
}

function isSameDisplayText(first: string, second: string): boolean {
  return normalizeDisplayText(first) === normalizeDisplayText(second);
}

function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
