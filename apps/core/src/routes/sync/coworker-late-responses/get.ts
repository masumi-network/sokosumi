import type { Hono } from "hono";

import { syncLateCoworkerResponses } from "@/services/coworker-late-responses-sync.service";

import { handleSyncRequest } from "../handler.js";

const COWORKER_LATE_RESPONSES_SYNC_LOCK_KEY = "coworker-late-responses-sync";

export default function mount(app: Hono) {
  app.get("/coworker-late-responses", async (c) => {
    return await handleSyncRequest(
      c,
      COWORKER_LATE_RESPONSES_SYNC_LOCK_KEY,
      async (context) => {
        const result = await syncLateCoworkerResponses({
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/coworker-late-responses] Completed sync", result);
      },
    );
  });
}
