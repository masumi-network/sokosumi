import { after, NextResponse } from "next/server";
import pLimit from "p-limit";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import {
  lockRepository,
  organizationRepository,
  userRepository,
} from "@/lib/db/repositories";
import { lockService, stripeService } from "@/lib/services";
import { Lock } from "@/prisma/generated/client";

const LOCK_KEY = "stripe-customers-sync";

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;
  return await stripeCustomersSync();
}

async function stripeCustomersSync(): Promise<Response> {
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
      await pTimeout(syncAllStripeCustomers(), {
        milliseconds:
          // give some buffer to unlock the lock before the timeout
          getEnvSecrets().LOCK_TIMEOUT - getEnvSecrets().LOCK_TIMEOUT_BUFFER,
      });
      const timingEnd = Date.now();
      console.info(
        "Stripe customers sync took",
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

async function syncAllStripeCustomers(): Promise<void> {
  const runningUpdates: Promise<void>[] = [];

  // Get all users without Stripe customer IDs
  const usersWithoutStripeCustomer =
    await userRepository.getUsersWithoutStripeCustomerId();

  // Get all organizations without Stripe customer IDs
  const organizationsWithoutStripeCustomer =
    await organizationRepository.getOrganizationsWithoutStripeCustomerId();

  console.info(
    "Syncing",
    usersWithoutStripeCustomer.length,
    "users and",
    organizationsWithoutStripeCustomer.length,
    "organizations without Stripe customers",
  );

  // Process 5 entities at a time
  const limit = pLimit(5);

  // Process users
  for (const user of usersWithoutStripeCustomer) {
    runningUpdates.push(
      limit(async () => {
        try {
          await stripeService.createStripeCustomerForUser(user.id);
          console.info(`Created Stripe customer for user ${user.id}`);
        } catch (error) {
          console.error(
            `Failed to create Stripe customer for user ${user.id}:`,
            error,
          );
        }
      }),
    );
  }

  // Process organizations
  for (const organization of organizationsWithoutStripeCustomer) {
    runningUpdates.push(
      limit(async () => {
        try {
          await stripeService.createStripeCustomerForOrganization(
            organization.id,
          );
          console.info(
            `Created Stripe customer for organization ${organization.id}`,
          );
        } catch (error) {
          console.error(
            `Failed to create Stripe customer for organization ${organization.id}:`,
            error,
          );
        }
      }),
    );
  }

  try {
    await Promise.allSettled(runningUpdates);
  } catch (error) {
    console.error("Error in sync operation:", error);
    throw error;
  }
}
