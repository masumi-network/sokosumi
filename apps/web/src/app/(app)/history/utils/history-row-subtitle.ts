import type { TransactionHistoryItem } from "@/lib/services/history.service";

export interface HistorySubtitleLabels {
  noDescription: string;
}

export function getHistoryRowSubtitle(
  item: TransactionHistoryItem,
  labels: HistorySubtitleLabels,
): string {
  const description = item.description?.trim();
  if (description && !isSameDisplayText(description, item.title)) {
    return description;
  }

  // Nothing links an unattributed spend to an entity, and a top up is only
  // ever described by the bucket it created, so the bucket is the one source
  // signal left on both. Reported, never guessed.
  if (
    (item.kind === "unattributed" || item.kind === "topUp") &&
    item.bucketSource
  ) {
    return formatBucketSource(item.bucketSource);
  }

  return labels.noDescription;
}

/** `STRIPE_SUBSCRIPTION_PERIOD` reads as a column name, not as a sentence. */
function formatBucketSource(bucketSource: string): string {
  const words = bucketSource.toLocaleLowerCase().split("_").join(" ");
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

function isSameDisplayText(first: string, second: string): boolean {
  return normalizeDisplayText(first) === normalizeDisplayText(second);
}

function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
