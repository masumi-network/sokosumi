import { Lock } from "@sokosumi/database";
import { jobRepository, lockRepository } from "@sokosumi/database/repositories";
import { after, NextResponse } from "next/server";
import pLimit from "p-limit";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import { jobService, lockService } from "@/lib/services";

const LOCK_KEY = "jobs-sync";

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;
  return await jobSync();
}

async function jobSync(): Promise<Response> {
  // Start a transaction to ensure atomicity
  let lock: Lock;
  try {
    lock = await lockService.acquireLock(LOCK_KEY, getEnvSecrets().INSTANCE_ID);
  } catch (error) {
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
      await pTimeout(syncAllJobs(), {
        milliseconds:
          // give some buffer to unlock the lock before the timeout
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
      try {
        await lockRepository.unlockByKey(lock.key);
      } catch (error) {
        console.error("Failed to unlock lock:", error);
      }
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

async function syncAllJobs(): Promise<void> {
  const runningDbUpdates: Promise<void>[] = [];

  const jobs = await jobRepository.getJobsNotFinished();

  console.info("Syncing", jobs.length, "jobs");
  // Process 5 jobs at a time
  const limit = pLimit(5);
  for (const job of jobs) {
    runningDbUpdates.push(limit(() => jobService.syncJob(job)));
  }
  try {
    await Promise.allSettled(runningDbUpdates);
  } catch (error) {
    console.error("Error in sync operation:", error);
    throw error;
  }
}
