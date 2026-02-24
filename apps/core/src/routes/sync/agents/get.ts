import type { Hono } from "hono";

import { agentSyncService } from "@/services/agent-sync.service";

import { handleSyncRequest } from "../handler.js";

export const AGENTS_SYNC_LOCK_KEY = "agents-sync";
export const AGENTS_SYNC_METADATA_KEY = "agents-sync-metadata";

export default function mount(app: Hono) {
  app.get("/agents", async (c) => {
    return await handleSyncRequest(
      c,
      AGENTS_SYNC_LOCK_KEY,
      async () => {
        await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY);
      },
    );
  });
}
