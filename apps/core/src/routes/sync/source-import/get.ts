import type { Hono } from "hono";

import { getEnv } from "@/config/env";
import { sourceImportSyncService } from "@/services/source-import-sync.service";

import { handleSyncRequest } from "../handler.js";

export const SOURCE_IMPORT_SYNC_LOCK_KEY = "source-import-sync";
const MIN_SOURCE_IMPORT_TIMEOUT_MS = 1000;

function getSourceImportDeadlineMs(): number {
  const syncTimeoutMs = Math.max(
    getEnv().LOCK_TIMEOUT - getEnv().LOCK_TIMEOUT_BUFFER,
    MIN_SOURCE_IMPORT_TIMEOUT_MS,
  );

  return Date.now() + syncTimeoutMs;
}

export default function mount(app: Hono) {
  app.get("/source-import", async (c) => {
    return await handleSyncRequest(c, SOURCE_IMPORT_SYNC_LOCK_KEY, async () => {
      console.info("[sync/source-import] Importing pending source imports");
      const startedAt = Date.now();
      const pendingBlobCount = await sourceImportSyncService.importPendingResultBlobs(
        {
          deadlineMs: getSourceImportDeadlineMs(),
        },
      );

      console.info(
        `[sync/source-import] Completed sync (pendingBlobs=${pendingBlobCount}, durationMs=${Date.now() - startedAt})`,
      );
    });
  });
}
