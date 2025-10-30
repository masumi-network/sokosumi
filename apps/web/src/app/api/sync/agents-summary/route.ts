import { Lock } from "@sokosumi/database";
import {
  agentRepository,
  lockRepository,
} from "@sokosumi/database/repositories";
import { after, NextResponse } from "next/server";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import { anthropicClient } from "@/lib/clients";
import { getAgentDescription } from "@/lib/helpers/agent";
import { lockService } from "@/lib/services";

const LOCK_KEY = "agents-summary-sync";

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;
  return await agentSummarySync();
}

async function agentSummarySync() {
  // Start a transaction to ensure atomicity
  let lock: Lock;
  try {
    lock = await lockService.acquireLock(LOCK_KEY, getEnvSecrets().INSTANCE_ID);
  } catch (error) {
    console.error(error);
    if (error instanceof Error && error.message === "LOCK_IS_LOCKED") {
      return NextResponse.json(
        { message: "Syncing already in progress" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { message: "Failed to acquire lock" },
      { status: 500 },
    );
  }

  after(async () => {
    try {
      const timingStart = Date.now();
      await pTimeout(syncAgentSummaries(), {
        milliseconds:
          // give some buffer to unlock the lock before the timeout
          getEnvSecrets().LOCK_TIMEOUT - getEnvSecrets().LOCK_TIMEOUT_BUFFER,
      });
      const timingEnd = Date.now();
      console.info(
        "Agent summary sync took",
        (timingEnd - timingStart) / 1000,
        "seconds",
      );
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      try {
        await lockRepository.unlockByKey(lock.key);
      } catch (error) {
        console.error("Failed to unlock lock:", error);
      }
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

async function syncAgentSummaries() {
  const limit = 20;
  const agentsWithoutSummary =
    await agentRepository.getAvailableAgentsWithoutSummary(limit);

  for (const agent of agentsWithoutSummary) {
    const description = getAgentDescription(agent);
    if (!description) {
      continue;
    }
    try {
      console.info(`Generating summary for agent ${agent.id}`);
      const summary = await anthropicClient.generateAgentSummary(description);
      if (!summary) {
        continue;
      }
      console.info(`Summary generated for agent ${agent.id}: ${summary}`);
      await agentRepository.updateAgentSummary(agent.id, summary);
      console.info(`Updated summary for agent ${agent.id}`);
    } catch (error) {
      console.error(`Failed to generate summary for agent ${agent.id}:`, error);
    }
  }
}
