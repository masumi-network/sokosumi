import type { Hono } from "hono";

import {
  backfillMissingSuggestionJobs,
  reviveFailedSuggestionJobs,
} from "@/lib/files/index-jobs";
import { pruneExpiredAdmissions } from "@/lib/files/jev-admission";
import { pruneExpiredResultWindows } from "@/lib/files/search-session";
import { processFileIndexJobs } from "@/services/file-index.service";
import { processFileSuggestionJobs } from "@/services/file-suggestions.service";
import { processStaleTableIndexes } from "@/services/file-table-index.service";

import { handleSyncRequest } from "../handler.js";

const DRIVE_INDEX_SYNC_LOCK_KEY = "drive-index-sync";

export default function mount(app: Hono) {
  app.get("/drive-index", async (c) => {
    return await handleSyncRequest(
      c,
      DRIVE_INDEX_SYNC_LOCK_KEY,
      async (context) => {
        /**
         * Before anything is leased: bring back suggestion jobs a long
         * outage left FAILED.
         *
         * Nothing else does. The lease takes QUEUED and expired-LEASED
         * rows, `enqueueFileIndexJob`'s only automatic caller is the
         * extraction chain, and `requeueFileIndexJob`'s only caller is the
         * reindex route — so a document whose attempts were spent against
         * a provider that was down stayed unlabelled through the recovery
         * and through a restart, recoverable only by a person asking, one
         * document at a time.
         *
         * Bounded by `FILE_INDEX_JOB_MAX_REVIVALS` and held off for
         * `FILE_INDEX_JOB_REVIVE_AFTER_MS`, so this cannot become a
         * every-minute retry of a document that is simply broken.
         */
        const revived = await reviveFailedSuggestionJobs();

        // Extraction first: a document has to have text before anything can
        // have an opinion about its category.
        const extraction = await processFileIndexJobs({
          shouldContinue: context.shouldContinue,
          // Not just `shouldContinue`. That is checked before leasing and
          // never during, so a job leased with a moment left still runs to
          // completion — past the lock's expiry, which lets the next tick
          // start this same pipeline alongside it. The budget makes the
          // loop refuse a job it cannot finish, and holds back a tail for
          // the three stages below, which extraction could otherwise
          // starve for the whole tick.
          msRemaining: context.msRemaining,
        });
        /**
         * And: give documents that were extracted before their workspace had
         * a vocabulary one run against the one it has now.
         *
         * Enqueued after extraction so a document that just gained text is
         * eligible in this same tick, and before the suggestion drain so the
         * work it queues runs immediately rather than a minute later.
         *
         * Bounded by `FILE_SUGGEST_BACKFILL_MAX_GENERATION`, so this is one
         * extra evaluation per document in total and not a per-minute retry.
         */
        const backfilled = await backfillMissingSuggestionJobs();
        const suggestions = await processFileSuggestionJobs({
          shouldContinue: context.shouldContinue,
        });
        // Tables carry their own staleness signal — `TableChange.sequence`
        // — so this re-indexes only what has actually moved.
        const tables = await processStaleTableIndexes({
          shouldContinue: context.shouldContinue,
        });
        // Nothing reads an admission older than the counting window except
        // an audit. Left alone the table grows by millions of rows a day at
        // the stated ceiling, and every admission scans past all of them.
        const prunedAdmissions = await pruneExpiredAdmissions();
        // The other table this feature grows without bound, for the same
        // reason and on the same cycle. A window past `expiresAt` is
        // refused on read, so these rows are unreachable — and one is
        // written per search per actor, each carrying a whole result
        // ordering. `@@index([expiresAt])` existed for this sweep before
        // the sweep did.
        const prunedResultWindows = await pruneExpiredResultWindows();
        console.info("[sync/drive-index] Completed sync", {
          revived,
          backfilled,
          extraction,
          suggestions,
          tables,
          prunedAdmissions,
          prunedResultWindows,
        });
      },
    );
  });
}
