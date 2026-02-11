import { Lock } from "@sokosumi/database";
import {
  lockRepository,
  syncMetadataRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { NextResponse } from "next/server";
import pLimit from "p-limit";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { lockService, stripeService } from "@/lib/services";

const LOCK_KEY = "stripe-free-user-subscription-sync";
const SYNC_METADATA_KEY = "stripe-free-user-subscription-sync";
const BATCH_SIZE = 100;
const INITIAL_SYNC_DATE = new Date(0);

interface StripeFreeSubscriptionSyncSummary {
  created: number;
  completed: boolean;
  failed: number;
  nextCursorId: string | null;
  scanned: number;
  skipped: number;
}

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;
  return await stripeFreeUserSubscriptionSync();
}

async function stripeFreeUserSubscriptionSync(): Promise<Response> {
  let lock: Lock;
  const syncStartedAt = Date.now();
  console.info(`[${LOCK_KEY}] Starting free user subscription sync run`);

  try {
    lock = await lockService.acquireLock(LOCK_KEY, getEnvSecrets().INSTANCE_ID);
    console.info(
      `[${LOCK_KEY}] Lock acquired by ${getEnvSecrets().INSTANCE_ID}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "LOCK_IS_LOCKED") {
      console.info(`[${LOCK_KEY}] Sync already in progress, skipping run`);
      return NextResponse.json(
        { message: "Syncing already in progress" },
        { status: 409 },
      );
    }
    console.error(`[${LOCK_KEY}] Failed to acquire lock`, error);
    return NextResponse.json(
      { message: "Failed to acquire lock" },
      { status: 500 },
    );
  }

  try {
    const summary = await syncUsersBatchToFreeSubscription();
    console.info(
      `[${LOCK_KEY}] Sync finished in ${(Date.now() - syncStartedAt) / 1000}s`,
      summary,
    );
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error(`[${LOCK_KEY}] Error syncing free user subscriptions`, error);
    return NextResponse.json(
      { message: "Failed to sync free user subscriptions" },
      { status: 500 },
    );
  } finally {
    try {
      await lockRepository.unlockByKey(lock.key, prisma);
      console.info(`[${LOCK_KEY}] Lock released`);
    } catch (error) {
      console.error(`[${LOCK_KEY}] Failed to unlock lock`, error);
    }
  }
}

async function syncUsersBatchToFreeSubscription(): Promise<StripeFreeSubscriptionSyncSummary> {
  const metadata = await syncMetadataRepository.getSyncMetadataByKey(
    SYNC_METADATA_KEY,
    prisma,
  );
  console.info(`[${LOCK_KEY}] Loaded sync metadata`, {
    cursorId: metadata.cursorId,
    lastSyncedAt: metadata.lastSyncedAt.toISOString(),
  });

  const isCompletedOnePass =
    metadata.cursorId === null &&
    metadata.lastSyncedAt.getTime() > INITIAL_SYNC_DATE.getTime();
  if (isCompletedOnePass) {
    console.info(`[${LOCK_KEY}] One-pass sync already completed, skipping`);
    return {
      created: 0,
      completed: true,
      failed: 0,
      nextCursorId: null,
      scanned: 0,
      skipped: 0,
    };
  }

  const users = await userRepository.getUsersBatchAfterCursor(
    metadata.cursorId,
    BATCH_SIZE,
    prisma,
  );
  console.info(`[${LOCK_KEY}] Loaded batch`, {
    batchSize: users.length,
    fromCursorId: metadata.cursorId,
    limit: BATCH_SIZE,
  });

  if (users.length === 0) {
    const completedAt = new Date();
    await syncMetadataRepository.setSyncMetadataByKey(
      SYNC_METADATA_KEY,
      null,
      completedAt,
      prisma,
    );
    console.info(`[${LOCK_KEY}] One-pass sync completed`, {
      completedAt: completedAt.toISOString(),
    });
    return {
      created: 0,
      completed: true,
      failed: 0,
      nextCursorId: null,
      scanned: 0,
      skipped: 0,
    };
  }

  const nextCursorId = users[users.length - 1]?.id ?? null;

  const summary: StripeFreeSubscriptionSyncSummary = {
    created: 0,
    completed: false,
    failed: 0,
    nextCursorId,
    scanned: users.length,
    skipped: 0,
  };

  const limit = pLimit(5);
  await Promise.allSettled(
    users.map((user) =>
      limit(async () => {
        const result = await stripeService.ensurePersonalFreeSubscription(
          user.id,
        );
        switch (result.status) {
          case "created":
            summary.created += 1;
            break;
          case "skipped":
            summary.skipped += 1;
            break;
          case "failed":
            summary.failed += 1;
            break;
        }
      }),
    ),
  );

  await syncMetadataRepository.setSyncMetadataByKey(
    SYNC_METADATA_KEY,
    nextCursorId,
    metadata.lastSyncedAt,
    prisma,
  );
  console.info(`[${LOCK_KEY}] Batch processed`, {
    ...summary,
    nextCursorId,
  });

  return summary;
}
