import { NextResponse } from "next/server";
import pLimit from "p-limit";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import { lockRepository } from "@/lib/db/repositories";
import { lockService } from "@/lib/services";
import { sourceImportService } from "@/lib/services/source-import.service";

const LOCK_KEY = "source-import-sync";

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;

  let unlocked = false;
  let lock;
  try {
    lock = await lockService.acquireLock(LOCK_KEY, getEnvSecrets().INSTANCE_ID);
  } catch (_error) {
    return NextResponse.json(
      { message: "Sync already in progress" },
      { status: 409 },
    );
  }

  try {
    const limit = pLimit(1);
    console.log("Importing pending source imports");
    const processed = await limit(() => sourceImportService.importPending(10));
    console.log("Imported", processed, "source imports");
    return NextResponse.json({ processed });
  } finally {
    if (!unlocked) {
      try {
        await lockRepository.unlockByKey(lock.key);
        unlocked = true;
      } catch (error) {
        console.error("Failed to unlock lock", error);
      }
    }
  }
}
