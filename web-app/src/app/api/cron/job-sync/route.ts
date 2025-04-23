import { after, NextResponse } from "next/server";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.config";
import { compareApiKeys } from "@/lib/auth/utils";
import { prisma } from "@/lib/db";
import { getLock, releaseLock, syncJobStatus } from "@/lib/services";
import { JobStatus } from "@/prisma/generated/client";

const LOCK_KEY = "job-sync";

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
      releaseLock(lock);
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

async function syncAllJobs() {
  const runningDbUpdates: Promise<void>[] = [];

  const jobs = await prisma.job.findMany({
    where: {
      status: {
        notIn: [
          JobStatus.PAYMENT_FAILED,
          JobStatus.COMPLETED,
          JobStatus.REFUND_RESOLVED,
          JobStatus.DISPUTE_RESOLVED,
        ],
      },
    },
  });

  for (const job of jobs) {
    runningDbUpdates.push(syncJobStatus(job));
  }

  await Promise.allSettled(runningDbUpdates);
}
