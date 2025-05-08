import { after, NextResponse } from "next/server";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.config";
import { compareApiKeys } from "@/lib/auth/utils";
import { FinalizedJobStatuses, prisma } from "@/lib/db";
import {
  acquireLock,
  getOrCreateLock,
  releaseLock,
  syncJobStatus,
} from "@/lib/services";
import { Lock } from "@/prisma/generated/client";

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
    lock = await getOrCreateLock(LOCK_KEY);
    if (lock.isLocked) {
      return NextResponse.json(
        { message: "Syncing already in progress" },
        { status: 429 },
      );
    }

    lock = await acquireLock(lock.key);
  } catch {
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
      releaseLock(lock.key);
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

async function syncAllJobs() {
  const runningDbUpdates: Promise<void>[] = [];

  const jobs = await prisma.job.findMany({
    where: {
      status: {
        notIn: FinalizedJobStatuses,
      },
    },
  });

  for (const job of jobs) {
    runningDbUpdates.push(syncJobStatus(job));
  }

  await Promise.allSettled(runningDbUpdates);
}
