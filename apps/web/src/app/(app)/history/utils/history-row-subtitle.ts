import { CHAT_MODELS } from "@sokosumi/chat";

import { slugify } from "@/app/chat/utils/bucket-slug";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import type { HistoryItem } from "@/lib/services/history.service";

export interface CoworkerBucketSource {
  slug: string;
  name: string;
  image?: string | null;
}

export type HistoryBucketIconPreview =
  | { kind: "model"; modelId: string; modelName: string }
  | { kind: "coworker"; name: string; imageUrl: string | null };

export interface HistoryBucketLookups {
  bucketDisplayNameBySlug: Record<string, string>;
  bucketIconBySlug: Record<string, HistoryBucketIconPreview>;
}

export interface HistorySubtitleLabels {
  noDescription: string;
}

export function createEmptyHistoryBucketLookups(): HistoryBucketLookups {
  return {
    bucketDisplayNameBySlug: {},
    bucketIconBySlug: {},
  };
}

export function getUniqueBucketSlugsFromHistory(
  history: HistoryItem[],
): string[] {
  return [
    ...new Set(
      history.flatMap((item) =>
        item.kind === "conversation" && item.bucketSlug
          ? [item.bucketSlug]
          : [],
      ),
    ),
  ];
}

export function buildBucketLookupFromCoworkers(
  bucketSlugs: string[],
  coworkers: CoworkerBucketSource[],
): HistoryBucketLookups {
  const coworkerBySlug = new Map<
    string,
    { name: string; imageUrl: string | null }
  >();

  for (const coworker of coworkers) {
    const preview = {
      name: coworker.name,
      imageUrl: getCoworkerImage(coworker),
    };
    coworkerBySlug.set(slugify(coworker.slug), preview);
    coworkerBySlug.set(slugify(coworker.name), preview);
  }

  const modelBySlug = new Map(
    CHAT_MODELS.flatMap((model) => [
      [slugify(model.name), model],
      [slugify(model.id), model],
    ]),
  );

  const bucketDisplayNameBySlug: Record<string, string> = {};
  const bucketIconBySlug: Record<string, HistoryBucketIconPreview> = {};

  for (const bucketSlug of bucketSlugs) {
    const normalizedSlug = slugify(bucketSlug);
    const coworker = coworkerBySlug.get(normalizedSlug);

    if (coworker) {
      bucketDisplayNameBySlug[bucketSlug] = coworker.name;
      bucketIconBySlug[bucketSlug] = {
        kind: "coworker",
        name: coworker.name,
        imageUrl: coworker.imageUrl,
      };
      continue;
    }

    const model = modelBySlug.get(normalizedSlug);
    if (model) {
      bucketDisplayNameBySlug[bucketSlug] = model.name;
      bucketIconBySlug[bucketSlug] = {
        kind: "model",
        modelId: model.id,
        modelName: model.name,
      };
      continue;
    }

    bucketDisplayNameBySlug[bucketSlug] = humanizeSlug(bucketSlug);
  }

  return {
    bucketDisplayNameBySlug,
    bucketIconBySlug,
  };
}

export function buildHistoryBucketLookupsFromItems(
  history: HistoryItem[],
  coworkers: CoworkerBucketSource[],
): HistoryBucketLookups {
  const bucketSlugs = getUniqueBucketSlugsFromHistory(history);

  if (bucketSlugs.length === 0) {
    return createEmptyHistoryBucketLookups();
  }

  return buildBucketLookupFromCoworkers(bucketSlugs, coworkers);
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

export function mergeHistoryBucketLookups(
  current: HistoryBucketLookups,
  next: HistoryBucketLookups,
): HistoryBucketLookups {
  return {
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
  lookups: HistoryBucketLookups,
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
  lookups: HistoryBucketLookups,
): string | null {
  switch (item.kind) {
    case "job":
      return item.agentName?.trim() || null;
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
