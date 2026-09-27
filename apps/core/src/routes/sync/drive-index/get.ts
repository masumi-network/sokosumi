import type { Hono } from "hono";

import { pruneExpiredAdmissions } from "@/lib/files/jev-admission";
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
        console.info("[sync/drive-index] Completed sync", {
          extraction,
          suggestions,
          tables,
          prunedAdmissions,
        });
      },
    );
  });
}
