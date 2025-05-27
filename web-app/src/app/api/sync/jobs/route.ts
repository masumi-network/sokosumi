import { after, NextResponse } from "next/server";
import pLimit from "p-limit";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.config";
import { compareApiKeys } from "@/lib/auth/utils";
import {
  acquireLock,
  finalizedOnChainJobStatuses,
  prisma,
  unlockLock,
} from "@/lib/db";
import { syncJob } from "@/lib/services";
import {
  AgentJobStatus,
  Lock,
  OnChainJobStatus,
} from "@/prisma/generated/client";

const LOCK_KEY = "jobs-sync";

export async function POST(request: Request) {
  const headerApiKey = request.headers.get("admin-api-key");
  if (!headerApiKey) {
    return NextResponse.json(
      { message: "No api key provided" },
      { status: 401 },
    );
  }
  if (compareApiKeys(headerApiKey) !== true) {
    return NextResponse.json({ message: "Invalid api key" }, { status: 401 });
  }
  // Start a transaction to ensure atomicity
  let lock: Lock;
  try {
    lock = await acquireLock(LOCK_KEY, getEnvSecrets().INSTANCE_ID);
  } catch (error) {
    if (error instanceof Error && error.message === "LOCK_IS_LOCKED") {
      return NextResponse.json(
        { message: "Syncing already in progress" },
        { status: 429 },
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
      await pTimeout(syncAllJobs(), {
        milliseconds:
          //give some buffer to unlock the lock before the timeout
          getEnvSecrets().LOCK_TIMEOUT - getEnvSecrets().LOCK_TIMEOUT_BUFFER,
      });
      const timingEnd = Date.now();
      console.info(
        "Job sync took",
        (timingEnd - timingStart) / 1000,
        "seconds",
      );
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      unlockLock(lock.key);
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

async function syncAllJobs() {
  const runningDbUpdates: Promise<void>[] = [];

  let jobs = await prisma.job.findMany({
    where: {
      OR: [
        {
          onChainStatus: {
            notIn: finalizedOnChainJobStatuses,
          },
        },
        {
          onChainStatus: null,
          nextActionErrorType: null,
        },
      ],
    },
  });

  // Filter out jobs that are already completed and the external dispute unlock time has passed
  const nowTimestamp = Date.now();
  jobs = jobs.filter((job) => {
    if (
      job.onChainStatus === OnChainJobStatus.RESULT_SUBMITTED &&
      job.agentJobStatus === AgentJobStatus.COMPLETED
    ) {
      return job.externalDisputeUnlockTime.getTime() > nowTimestamp;
    }
    return true;
  });

  // Process 5 jobs at a time
  const limit = pLimit(5);
  for (const job of jobs) {
    runningDbUpdates.push(limit(() => syncJob(job)));
  }
  try {
    await Promise.allSettled(runningDbUpdates);
  } catch (error) {
    console.error("Error in sync operation:", error);
    throw error;
  }
}
