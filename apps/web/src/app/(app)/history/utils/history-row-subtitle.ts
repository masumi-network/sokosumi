import type { HistoryItem } from "@/lib/services/history.service";

export type HistoryBucketIconPreview =
  | { kind: "model"; modelId: string; modelName: string }
  | { kind: "coworker"; name: string; imageUrl: string | null };

export interface HistorySubtitleLookups {
  agentPreviewById: Record<string, { name: string; icon: string | null }>;
  bucketDisplayNameBySlug: Record<string, string>;
  bucketIconBySlug: Record<string, HistoryBucketIconPreview>;
}

export interface HistorySubtitleLabels {
  noDescription: string;
}

export function createEmptyHistorySubtitleLookups(): HistorySubtitleLookups {
  return {
    agentPreviewById: {},
    bucketDisplayNameBySlug: {},
    bucketIconBySlug: {},
  };
}

export function mergeHistorySubtitleLookups(
  current: HistorySubtitleLookups,
  next: HistorySubtitleLookups,
): HistorySubtitleLookups {
  return {
    agentPreviewById: {
      ...current.agentPreviewById,
      ...next.agentPreviewById,
    },
    bucketDisplayNameBySlug: {
      ...current.bucketDisplayNameBySlug,
      ...next.bucketDisplayNameBySlug,
    },
    bucketIconBySlug: {
      ...current.bucketIconBySlug,
      ...next.bucketIconBySlug,
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
      return lookups.agentPreviewById[item.agentId]?.name.trim() || null;
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
