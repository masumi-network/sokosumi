import type { Hono } from "hono";

import { refreshSkillCatalog } from "@/services/skill-catalog.service";

import { handleSyncRequest } from "../handler.js";

const SKILL_CATALOG_SYNC_LOCK_KEY = "skill-catalog-sync";

/**
 * Re-read the skills.sh leaderboard into the catalog the chat skill picker
 * searches. Daily: the leaderboard moves slowly, and each run reads one page
 * plus the pages of skills that have no description yet.
 */
export default function mount(app: Hono) {
  app.get("/skill-catalog", async (c) => {
    return await handleSyncRequest(
      c,
      SKILL_CATALOG_SYNC_LOCK_KEY,
      async (context) => {
        const refreshed = await refreshSkillCatalog({
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/skill-catalog] Completed sync", refreshed);
      },
    );
  });
}
