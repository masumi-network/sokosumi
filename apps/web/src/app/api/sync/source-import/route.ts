import { after, NextResponse } from "next/server";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import { lockRepository } from "@/lib/db/repositories";
import { lockService } from "@/lib/services";
import { sourceImportService } from "@/lib/services/source-import.service";

const LOCK_KEY = "source-import-sync";

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;

  const unlocked = false;
  let lock;
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
      console.log("Importing pending source imports");
      const pendingBlobsCount = await pTimeout(
        sourceImportService.importPendingOutputBlobs(),
        {
          milliseconds:
            getEnvSecrets().LOCK_TIMEOUT - getEnvSecrets().LOCK_TIMEOUT_BUFFER,
        },
      );
      console.log("Pending Blobs: ", pendingBlobsCount);
      const timingEnd = Date.now();
      console.log(
        "Source import sync took",
        (timingEnd - timingStart) / 1000,
        "seconds",
      );
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      if (!unlocked) {
        try {
          await lockRepository.unlockByKey(lock.key);
        } catch (error) {
          console.error("Failed to unlock lock:", error);
        }
      }
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}
