import "server-only";

import {
  buildBucketLookupFromCoworkers,
  createEmptyHistoryBucketLookups,
  getUniqueBucketSlugsFromHistory,
  type HistoryBucketLookups,
} from "@/app/history/utils/history-row-subtitle";
import { coworkerService } from "@/lib/services/coworker.service";
import type { HistoryItem } from "@/lib/services/history.service";

export async function buildHistoryBucketLookups(
  history: HistoryItem[],
): Promise<HistoryBucketLookups> {
  const bucketSlugs = getUniqueBucketSlugsFromHistory(history);

  if (bucketSlugs.length === 0) {
    return createEmptyHistoryBucketLookups();
  }

  const coworkers = await coworkerService.listCoworkers().catch(() => []);

  return buildBucketLookupFromCoworkers(bucketSlugs, coworkers);
}
