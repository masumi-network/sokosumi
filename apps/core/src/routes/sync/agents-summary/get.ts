import type { Hono } from "hono";

import { agentSyncService } from "@/services/agent-sync.service";

import { handleSyncRequest } from "../handler.js";

export const AGENTS_SUMMARY_SYNC_LOCK_KEY = "agents-summary-sync";

export default function mount(app: Hono) {
  app.get("/agents-summary", async (c) => {
    return await handleSyncRequest(
      c,
      AGENTS_SUMMARY_SYNC_LOCK_KEY,
      async (context) => {
        await agentSyncService.syncAgentSummaries({
          shouldContinue: context.shouldContinue,
        });
      },
    );
  });
}
