import type { Hono } from "hono";

import { openrouterClient } from "@/clients/openrouter.client";
import { networkKey } from "@/lib/network";
import { agentSyncService } from "@/services/agent-sync.service";

import { handleSyncRequest } from "../handler.js";

const network = "mainnet";
const AGENTS_SUMMARY_SYNC_LOCK_KEY = networkKey(network, "agents-summary-sync");

export default function mount(app: Hono) {
  app.get("/agents-summary", async (c) => {
    return await handleSyncRequest(
      c,
      AGENTS_SUMMARY_SYNC_LOCK_KEY,
      async (context) => {
        await agentSyncService.syncAgentSummaries(
          context.scope,
          openrouterClient,
          {
            abortSignal: context.abortSignal,
            shouldContinue: context.shouldContinue,
          },
        );
      },
      { network, errorDetail: "safe-fields" },
    );
  });
}
