import "server-only";

import { CHAT_MODELS } from "@sokosumi/chat";

import { slugify } from "@/app/chat/utils/bucket-slug";
import {
  createEmptyHistoryBucketLookups,
  type HistoryBucketIconPreview,
  type HistoryBucketLookups,
} from "@/app/history/utils/history-row-subtitle";
import { getCoworkerImage } from "@/app/tasks/utils/coworker-image";
import { coworkerService } from "@/lib/services/coworker.service";
import type { HistoryItem } from "@/lib/services/history.service";

export async function buildHistoryBucketLookups(
  history: HistoryItem[],
): Promise<HistoryBucketLookups> {
  const bucketSlugs = getUniqueBucketSlugs(history);

  if (bucketSlugs.length === 0) {
    return createEmptyHistoryBucketLookups();
  }

  return buildBucketLookup(bucketSlugs);
}

function getUniqueBucketSlugs(history: HistoryItem[]): string[] {
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

async function buildBucketLookup(
  bucketSlugs: string[],
): Promise<HistoryBucketLookups> {
  const coworkers = await coworkerService.listCoworkers().catch(() => []);
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

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}
