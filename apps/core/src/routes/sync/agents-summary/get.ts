import type { Hono } from "hono";

import { openrouterClient } from "@/clients/openrouter.client";
import { getEnv } from "@/config/env";
import { NETWORKS } from "@/lib/network";
import { agentSyncService } from "@/services/agent-sync.service";

import { handleSyncRequest } from "../handler.js";

const AGENTS_SUMMARY_SYNC_LOCK_KEY = "agents-summary-sync";

export default function mount(app: Hono) {
  for (const network of NETWORKS) {
    const path =
      network === "mainnet" ? "/agents-summary" : "/preprod/agents-summary";
    app.get(path, async (c) => {
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
              write: context.lease.write,
            },
          );
        },
        {
          network,
          errorDetail: "safe-fields",
          enabled: () =>
            network === "mainnet" ||
            Boolean(getEnv().OPENROUTER_DEFAULT_API_KEY),
        },
      );
    });
  }
}
