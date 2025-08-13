import { after, NextResponse } from "next/server";
import pLimit from "p-limit";
import pTimeout from "p-timeout";

import { getEnvSecrets } from "@/config/env.secrets";
import { authenticateCronSecret } from "@/lib/auth/utils";
import { stripeClient } from "@/lib/clients/stripe.client";
import {
  cursorRepository,
  lockRepository,
  organizationRepository,
  userRepository,
} from "@/lib/db/repositories";
import { lockService } from "@/lib/services";
import { Lock } from "@/prisma/generated/client";

const CURSOR_ID = "stripe-customers-cleanup";
const LOCK_KEY = "stripe-customers-cleanup";
const CUSTOMERS_PER_CHUNK = 200;

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
  console.info(`Starting Stripe customer cleanup with chunked processing`);

  // Get cursor position
  const cursorRecord = await cursorRepository.getCursor(CURSOR_ID);
  const startingAfter = cursorRecord?.cursor ?? undefined;

  console.info(
    startingAfter
      ? `Resuming from cursor: ${startingAfter}`
      : "Starting from beginning",
  );

  // Fetch a chunk of Stripe customers
  const {
    customers: stripeCustomers,
    hasMore,
    lastId,
  } = await stripeClient.getCustomersChunk(startingAfter, CUSTOMERS_PER_CHUNK);

  console.info(
    `Found ${stripeCustomers.length} Stripe customers in chunk (hasMore: ${hasMore})`,
  );

  if (stripeCustomers.length === 0) {
    console.info("No customers in chunk, resetting cursor");
    await cursorRepository.resetCursor(CURSOR_ID);
    return;
  }

  // Get all customer IDs from our database
  const [userCustomerIds, organizationCustomerIds] = await Promise.all([
    userRepository.getUserStripeCustomerIds(),
    organizationRepository.getOrganizationStripeCustomerIds(),
  ]);

  const dbCustomerIds = new Set([
    ...userCustomerIds,
    ...organizationCustomerIds,
  ]);
  console.info(`Found ${dbCustomerIds.size} customer IDs in database`);

  // Identify orphaned customers in this chunk
  const orphanedCustomers = stripeCustomers.filter(
    (customer) => !dbCustomerIds.has(customer.id),
  );

  console.info(`Found ${orphanedCustomers.length} orphaned customers in chunk`);

  // Delete customers in batches if any orphaned customers found
  if (orphanedCustomers.length > 0) {
    const limit = pLimit(5);
    const deletionPromises = orphanedCustomers.map((customer) =>
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
    console.info(`Deleted ${orphanedCustomers.length} orphaned customers`);
  }

  // Find the last non-deleted (non-orphaned) customer ID for the cursor
  let cursorId: string | undefined = cursorRecord?.cursor ?? undefined;

  // Search from the end of the array backwards to find last non-orphaned customer
  for (const customer of stripeCustomers.toReversed()) {
    if (dbCustomerIds.has(customer.id)) {
      cursorId = customer.id;
      break;
    }
  }

  // Update cursor for next run
  if (hasMore && cursorId) {
    // Save cursor to continue from this position next time
    await cursorRepository.setCursor(CURSOR_ID, cursorId);
    console.info(
      `Saved cursor position: ${cursorId}${cursorId !== lastId ? " (last non-deleted customer)" : ""}`,
    );
  } else {
    // No more customers, reset cursor to start from beginning next time
    await cursorRepository.resetCursor(CURSOR_ID);
    console.info("Reached end of customers, reset cursor for next cycle");
  }

  console.info(
    `Cleanup chunk completed. Processed ${stripeCustomers.length} customers, deleted ${orphanedCustomers.length} orphaned customers`,
  );
}
