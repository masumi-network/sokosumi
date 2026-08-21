import type { Hono } from "hono";

import { sourceImportSyncService } from "@/services/source-import-sync.service";

import { handleSyncRequest } from "../handler.js";

export const SOURCE_IMPORT_SYNC_LOCK_KEY = "source-import-sync";

export default function mount(app: Hono) {
  app.get("/source-import", async (c) => {
    return await handleSyncRequest(
      c,
      SOURCE_IMPORT_SYNC_LOCK_KEY,
      async (context) => {
        console.info("[sync/source-import] Importing pending source imports");
        const startedAt = Date.now();
        const pendingBlobCount =
          await sourceImportSyncService.importPendingResultBlobs({
            abortSignal: context.abortSignal,
            deadlineMs: context.deadlineMs,
            shouldContinue: context.shouldContinue,
          });

        console.info(
          `[sync/source-import] Completed import sync (pendingBlobs=${pendingBlobCount}, durationMs=${Date.now() - startedAt})`,
        );

        // Backfill historical TaskEvent comments
        console.info("[sync/source-import] Starting comment backfill");
        const backfillStartedAt = Date.now();
        const backfilledCount =
          await sourceImportSyncService.backfillTaskEventComments({
            abortSignal: context.abortSignal,
            deadlineMs: context.deadlineMs,
            shouldContinue: context.shouldContinue,
          });

        console.info(
          `[sync/source-import] Completed comment backfill (processedEvents=${backfilledCount}, durationMs=${Date.now() - backfillStartedAt})`,
        );
      },
    );
  });
}
