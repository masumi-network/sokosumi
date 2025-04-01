import { after, NextResponse } from "next/server";

import { getEnvSecrets } from "@/config/env.config";
import prisma from "@/lib/db/prisma";
import { syncJobStatus } from "@/lib/db/services/job.service";
import { getLock, releaseLock, timeLimitedExecution } from "@/lib/utils";

const LOCK_KEY = "job-sync";

export async function POST(request: Request) {
  if (request.headers.get("admin-api-key") !== getEnvSecrets().ADMIN_KEY) {
    return NextResponse.json({ message: "Invalid api key" }, { status: 401 });
  }
  // Start a transaction to ensure atomicity
  const lock = await getLock(LOCK_KEY);

  if (!lock) {
    return NextResponse.json(
      { message: "Syncing already in progress" },
      { status: 429 },
    );
  }

  after(async () => {
    try {
      const timingStart = Date.now();
      await timeLimitedExecution(
        syncAllJobs,
        //give some buffer to unlock the lock before the timeout
        getEnvSecrets().LOCK_TIMEOUT - 1000 * 25,
      );
      const timingEnd = Date.now();
      console.info(
        "Job sync took",
        (timingEnd - timingStart) / 1000,
        "seconds",
      );
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      releaseLock(lock);
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

async function syncAllJobs() {
  const runningDbUpdates: Promise<void>[] = [];

  const jobs = await prisma.job.findMany({
    where: {
      status: "PAYMENT_PENDING",
    },
  });

  for (const job of jobs) {
    runningDbUpdates.push(syncJobStatus(job));
  }

  await Promise.allSettled(runningDbUpdates);
}
