import type { Hono } from "hono";

import { sourceImportSyncService } from "@/services/source-import-sync.service";

import { handleSyncRequest } from "../handler.js";

const SOURCE_IMPORT_SYNC_LOCK_KEY = "source-import-sync";

export default function mount(app: Hono) {
  app.get("/source-import", async (c) => {
    return await handleSyncRequest(
      c,
      SOURCE_IMPORT_SYNC_LOCK_KEY,
      async (context) => {
        const pendingBlobCount =
          await sourceImportSyncService.importPendingResultBlobs({
            abortSignal: context.abortSignal,
            deadlineMs: context.deadlineMs,
            shouldContinue: context.shouldContinue,
          });

        context.log.set({ result: { pendingBlobs: pendingBlobCount } });
      },
      { errorDetail: "safe-fields" },
    );
  });
}
