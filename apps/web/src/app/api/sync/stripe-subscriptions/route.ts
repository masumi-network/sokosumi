import { Lock } from "@sokosumi/database";
import { lockRepository } from "@sokosumi/database/repositories";
import { after, NextResponse } from "next/server";
import pLimit from "p-limit";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { lockService, stripeService } from "@/lib/services";

const LOCK_KEY = "stripe-subscriptions-sync";

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;
  return await stripeSubscriptionsSync();
}

async function stripeSubscriptionsSync(): Promise<Response> {
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
      await pTimeout(syncAllStripeSubscriptions(), {
        milliseconds:
          getEnvSecrets().LOCK_TIMEOUT - getEnvSecrets().LOCK_TIMEOUT_BUFFER,
      });
      const timingEnd = Date.now();
      console.info(
        "Stripe subscriptions sync took",
        (timingEnd - timingStart) / 1000,
        "seconds",
      );
    } catch (error) {
      console.error("Error in subscription sync operation:", error);
    } finally {
      try {
        await lockRepository.unlockByKey(lock.key, prisma);
      } catch (error) {
        console.error("Failed to unlock lock:", error);
      }
    }
  });

  return NextResponse.json({ message: "Syncing started" }, { status: 200 });
}

async function syncAllStripeSubscriptions(): Promise<void> {
  const usersWithStripeCustomer = await prisma.user.findMany({
    where: {
      stripeCustomerId: {
        not: null,
      },
    },
    select: {
      id: true,
      stripeCustomerId: true,
    },
  });

  console.info(
    "Syncing subscriptions for",
    usersWithStripeCustomer.length,
    "users with Stripe customers",
  );

  const runningUpdates: Promise<void>[] = [];
  const limit = pLimit(5);

  for (const user of usersWithStripeCustomer) {
    const stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      continue;
    }
    runningUpdates.push(
      limit(async () => {
        try {
          const result = await stripeService.syncSubscriptionRowsForReference(
            user.id,
            stripeCustomerId,
          );
          if (result.created > 0 || result.updated > 0) {
            console.info(
              `Synced subscriptions for user ${user.id} (created=${result.created}, updated=${result.updated}, skipped=${result.skipped})`,
            );
          }
        } catch (error) {
          console.error(
            `Failed to sync subscriptions for user ${user.id}:`,
            error,
          );
        }
      }),
    );
  }

  try {
    await Promise.allSettled(runningUpdates);
  } catch (error) {
    console.error("Error in subscription sync operation:", error);
    throw error;
  }
}
