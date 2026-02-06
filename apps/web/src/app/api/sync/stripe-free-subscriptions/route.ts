import { Lock } from "@sokosumi/database";
import { lockRepository } from "@sokosumi/database/repositories";
import { NextResponse } from "next/server";
import pLimit from "p-limit";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { lockService, stripeService } from "@/lib/services";

const LOCK_KEY = "stripe-free-subscriptions-sync";

interface StripeFreeSubscriptionSyncSummary {
  created: number;
  failed: number;
  scanned: number;
  skipped: number;
}

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;
  return await stripeFreeSubscriptionsSync();
}

async function stripeFreeSubscriptionsSync(): Promise<Response> {
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

  try {
    const summary = await syncAllUsersToFreeSubscription();
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("Error syncing free subscriptions:", error);
    return NextResponse.json(
      { message: "Failed to sync free subscriptions" },
      { status: 500 },
    );
  } finally {
    try {
      await lockRepository.unlockByKey(lock.key, prisma);
    } catch (error) {
      console.error("Failed to unlock lock:", error);
    }
  }
}

async function syncAllUsersToFreeSubscription(): Promise<StripeFreeSubscriptionSyncSummary> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
    },
  });

  const summary: StripeFreeSubscriptionSyncSummary = {
    created: 0,
    failed: 0,
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

  return summary;
}
