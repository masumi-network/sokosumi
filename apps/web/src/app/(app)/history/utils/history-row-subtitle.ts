import type { HistoryItem } from "@/lib/services/history.service";

export interface HistorySubtitleLabels {
  noDescription: string;
}

export function getHistoryRowSubtitle(
  item: HistoryItem,
  labels: HistorySubtitleLabels,
): string {
  // An image row's `description` is Core's search text, not display text: it
  // carries the raw provider endpoint ("fal-ai/flux-2-pro") because SQL cannot
  // see the studio catalog's labels, and Core resolves the readable name into
  // `modelLabel` for exactly this purpose. The title is already the prompt, so
  // the model is what the second line is for.
  if (item.kind === "image") {
    return item.modelLabel.trim() || labels.noDescription;
  }

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
