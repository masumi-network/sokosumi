import { after, NextResponse } from "next/server";
import pLimit from "p-limit";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import { stripeClient } from "@/lib/clients/stripe.client";
import {
  lockRepository,
  organizationRepository,
  userRepository,
} from "@/lib/db/repositories";
import { lockService } from "@/lib/services";
import { Lock } from "@/prisma/generated/client";

const LOCK_KEY = "stripe-customers-cleanup";
const MAX_DELETIONS_PER_RUN = 100;

export async function GET(request: Request) {
  const authResult = authenticateCronSecret(request);
  if (!authResult.ok) return authResult.response;
  return await stripeCustomersCleanup();
}

async function stripeCustomersCleanup(): Promise<Response> {
  let lock: Lock;
  try {
    lock = await lockService.acquireLock(LOCK_KEY, getEnvSecrets().INSTANCE_ID);
  } catch (error) {
    if (error instanceof Error && error.message === "LOCK_IS_LOCKED") {
      return NextResponse.json(
        { message: "Cleanup already in progress" },
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
      await pTimeout(cleanupOrphanedStripeCustomers(), {
        milliseconds:
          getEnvSecrets().LOCK_TIMEOUT - getEnvSecrets().LOCK_TIMEOUT_BUFFER,
      });
      const timingEnd = Date.now();
      console.info(
        "Stripe customers cleanup took",
        (timingEnd - timingStart) / 1000,
        "seconds",
      );
    } catch (error) {
      console.error("Error in cleanup operation:", error);
    } finally {
      try {
        await lockRepository.unlockByKey(lock.key);
      } catch (error) {
        console.error("Failed to unlock lock:", error);
      }
    }
  });

  return NextResponse.json({ message: `Cleanup started` }, { status: 200 });
}

async function cleanupOrphanedStripeCustomers(): Promise<void> {
  console.info(`Starting Stripe customer cleanup`);

  // Get all Stripe customers
  const stripeCustomers = await stripeClient.getCustomers();
  console.info(`Found ${stripeCustomers.length} Stripe customers`);

  // Get all customer IDs from our database
  const [userCustomerIds, organizationCustomerIds] = await Promise.all([
    userRepository.getAllUserStripeCustomerIds(),
    organizationRepository.getAllOrganizationStripeCustomerIds(),
  ]);

  const dbCustomerIds = new Set([
    ...userCustomerIds,
    ...organizationCustomerIds,
  ]);
  console.info(`Found ${dbCustomerIds.size} customer IDs in database`);

  // Identify orphaned customers
  const orphanedCustomers = stripeCustomers.filter(
    (customer) => !dbCustomerIds.has(customer.id),
  );

  console.info(`Found ${orphanedCustomers.length} orphaned customers`);

  if (orphanedCustomers.length === 0) {
    console.info("No orphaned customers to clean up");
    return;
  }

  // Limit deletions per run
  const customersToDelete = orphanedCustomers.slice(0, MAX_DELETIONS_PER_RUN);
  if (customersToDelete.length < orphanedCustomers.length) {
    console.info(
      `Limited to ${MAX_DELETIONS_PER_RUN} deletions per run. ${
        orphanedCustomers.length - customersToDelete.length
      } customers will be processed in next run`,
    );
  }

  if (customersToDelete.length === 0) {
    console.info("No customers safe to delete");
    return;
  }

  // Delete customers in batches
  const limit = pLimit(5);
  const deletionPromises = customersToDelete.map((customer) =>
    limit(async () => {
      try {
        await stripeClient.deleteCustomer(customer.id);
        console.info(`Deleted orphaned customer ${customer.id}`);
      } catch (error) {
        console.error(`Failed to delete customer ${customer.id}:`, error);
      }
    }),
  );

  await Promise.allSettled(deletionPromises);

  console.info(
    `Cleanup completed. Processed ${customersToDelete.length} customers`,
  );
}
