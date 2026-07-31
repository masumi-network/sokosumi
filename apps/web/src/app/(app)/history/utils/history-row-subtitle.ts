import type { HistoryItem } from "@/lib/services/history.service";

export interface HistorySubtitleLabels {
  noDescription: string;
}

export function getHistoryRowSubtitle(
  item: HistoryItem,
  labels: HistorySubtitleLabels,
): string {
  const description = item.description?.trim();
  if (description) return description;

  const fallback = getHistoryRowSubtitleFallback(item);
  if (fallback && !isSameDisplayText(fallback, item.title)) return fallback;

  return labels.noDescription;
}

function getHistoryRowSubtitleFallback(item: HistoryItem): string | null {
  if (item.kind === "job") {
    return item.agentName?.trim() || null;
  }

  return null;
}

function isSameDisplayText(first: string, second: string): boolean {
  return normalizeDisplayText(first) === normalizeDisplayText(second);
}

function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
