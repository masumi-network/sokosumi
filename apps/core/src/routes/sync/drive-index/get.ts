import type { Hono } from "hono";

import { processFileIndexJobs } from "@/services/file-index.service";
import { processFileSuggestionJobs } from "@/services/file-suggestions.service";

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
        });
        const suggestions = await processFileSuggestionJobs({
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/drive-index] Completed sync", {
          extraction,
          suggestions,
        });
      },
    );
  });
}
