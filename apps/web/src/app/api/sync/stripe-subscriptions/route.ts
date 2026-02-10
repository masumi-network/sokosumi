import { Lock } from "@sokosumi/database";
import {
  lockRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { after, NextResponse } from "next/server";
import pLimit from "p-limit";
import pTimeout from "p-timeout";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import { stripeClient } from "@/lib/clients/stripe.client";
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
  const [usersWithStripeCustomer, stripeSubscriptions] = await Promise.all([
    userRepository.getUsersWithStripeCustomerId(prisma),
    stripeClient.listAllSubscriptions(),
  ]);

  console.info(
    "Syncing subscriptions for",
    stripeSubscriptions.length,
    "Stripe subscriptions",
  );

  const userReferenceByStripeCustomerId = new Map<string, string>();
  for (const user of usersWithStripeCustomer) {
    if (!user.stripeCustomerId) {
      continue;
    }
    userReferenceByStripeCustomerId.set(user.stripeCustomerId, user.id);
  }

  const subscriptionsByStripeCustomerId = new Map<
    string,
    Stripe.Subscription[]
  >();
  for (const subscription of stripeSubscriptions) {
    const stripeCustomerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;
    if (!stripeCustomerId) {
      continue;
    }
    const currentSubscriptions =
      subscriptionsByStripeCustomerId.get(stripeCustomerId) ?? [];
    currentSubscriptions.push(subscription);
    subscriptionsByStripeCustomerId.set(stripeCustomerId, currentSubscriptions);
  }

  const runningUpdates: Promise<void>[] = [];
  const limit = pLimit(5);

  for (const [
    stripeCustomerId,
    customerSubscriptions,
  ] of subscriptionsByStripeCustomerId.entries()) {
    const userReferenceId =
      userReferenceByStripeCustomerId.get(stripeCustomerId);
    if (!userReferenceId) {
      continue;
    }

    runningUpdates.push(
      limit(async () => {
        try {
          const result = await stripeService.syncSubscriptionRowsForReference(
            userReferenceId,
            stripeCustomerId,
            customerSubscriptions,
          );
          if (result.created > 0 || result.updated > 0) {
            console.info(
              `Synced subscriptions for user ${userReferenceId} (created=${result.created}, updated=${result.updated}, skipped=${result.skipped})`,
            );
          }
        } catch (error) {
          console.error(
            `Failed to sync subscriptions for user ${userReferenceId}:`,
            error,
          );
        }
      }),
    );
  }

  await Promise.allSettled(runningUpdates);
}
