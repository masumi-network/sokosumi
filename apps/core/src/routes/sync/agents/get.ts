import type { Hono } from "hono";

import {
  AGENTS_SYNC_LOCK_KEY,
  agentSyncService,
} from "@/services/agent-sync.service";

import { handleSyncRequest } from "../handler.js";

export default function mount(app: Hono) {
  app.get("/agents", async (c) => {
    return await handleSyncRequest(
      c.req.header("authorization") ?? null,
      AGENTS_SYNC_LOCK_KEY,
      async () => {
        await agentSyncService.syncRegistryAgents();
      },
    );
  });
}
