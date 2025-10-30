import { Lock } from "@sokosumi/database";
import { lockRepository } from "@sokosumi/database/repositories";
import { after, NextResponse } from "next/server";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import { jobScheduleService, lockService } from "@/lib/services";

const LOCK_KEY = "job-schedules-sync";

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;
  return await jobSchedulesSync();
}

async function jobSchedulesSync(): Promise<Response> {
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
      const result = await pTimeout(jobScheduleService.executeDueSchedules(), {
        milliseconds:
          getEnvSecrets().LOCK_TIMEOUT - getEnvSecrets().LOCK_TIMEOUT_BUFFER,
      });
      const timingEnd = Date.now();
      console.info("Job schedules sync", {
        seconds: (timingEnd - timingStart) / 1000,
        dueFound: result.dueFound,
        processed: result.processed,
        paused: result.paused,
        durationMs: result.durationMs,
      });
    } catch (error) {
      console.error("Error in job schedules sync operation:", error);
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
