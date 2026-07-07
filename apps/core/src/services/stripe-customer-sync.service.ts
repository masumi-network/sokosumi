import pLimit from "p-limit";

import prisma from "@/lib/db/prisma";
import {
  provisionOrganizationStripeCustomer,
  provisionUserStripeCustomer,
} from "@/services/stripe-customer-provision.service";

const STRIPE_CUSTOMER_SYNC_CONCURRENCY = 5;
const MIN_STRIPE_REQUEST_TIMEOUT_MS = 1000;

interface SyncExecutionOptions {
  deadlineMs: number;
  msRemaining: () => number;
  shouldContinue: () => boolean;
}

function hasTimeRemaining(deadlineMs: number): boolean {
  return Date.now() < deadlineMs;
}

function shouldStopSync(
  options: SyncExecutionOptions,
  reason: string,
): boolean {
  if (!options.shouldContinue()) {
    console.info(`[sync/stripe-customers] ${reason}`);
    return true;
  }

  if (!hasTimeRemaining(options.deadlineMs)) {
    console.info(`[sync/stripe-customers] ${reason}`);
    return true;
  }

  return false;
}

function getStripeRequestTimeoutMs(options: SyncExecutionOptions): number {
  const remainingMs = Math.min(
    options.msRemaining(),
    options.deadlineMs - Date.now(),
  );

  return Math.max(MIN_STRIPE_REQUEST_TIMEOUT_MS, remainingMs);
}

async function createStripeCustomerForUser(
  userId: string,
  options: SyncExecutionOptions,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      id: true,
      name: true,
    },
  });

  if (!user) {
    return;
  }

  const requestTimeoutMs = getStripeRequestTimeoutMs(options);
  await provisionUserStripeCustomer(
    {
      email: user.email,
      id: user.id,
      name: user.name,
    },
    {
      timeout: requestTimeoutMs,
    },
  );

  console.info(`Created Stripe customer for user ${user.id}`);
}

async function createStripeCustomerForOrganization(
  organizationId: string,
  options: SyncExecutionOptions,
): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });

  if (!organization) {
    return;
  }

  const requestTimeoutMs = getStripeRequestTimeoutMs(options);
  await provisionOrganizationStripeCustomer(
    {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    {
      timeout: requestTimeoutMs,
    },
  );

  console.info(`Created Stripe customer for organization ${organization.id}`);
}

export const stripeCustomerSyncService = {
  async syncAllStripeCustomers(options: SyncExecutionOptions): Promise<void> {
    const [usersWithoutStripeCustomer, organizationsWithoutStripeCustomer] =
      await Promise.all([
        prisma.user.findMany({
          where: {
            stripeCustomerId: null,
          },
          select: {
            id: true,
          },
        }),
        prisma.organization.findMany({
          where: {
            stripeCustomerId: null,
          },
          select: {
            id: true,
          },
        }),
      ]);

    console.info(
      "Syncing",
      usersWithoutStripeCustomer.length,
      "users without Stripe customers",
    );
    console.info(
      "Syncing",
      organizationsWithoutStripeCustomer.length,
      "organizations without Stripe customers",
    );

    const limit = pLimit(STRIPE_CUSTOMER_SYNC_CONCURRENCY);
    const runningSyncPromises: Promise<void>[] = [];
    for (const user of usersWithoutStripeCustomer) {
      if (
        shouldStopSync(
          options,
          "Stopping before scheduling more user sync operations",
        )
      ) {
        break;
      }

      runningSyncPromises.push(
        limit(async () => {
          if (
            shouldStopSync(
              options,
              `Stopping before processing user ${user.id}`,
            )
          ) {
            return;
          }

          try {
            await createStripeCustomerForUser(user.id, options);
          } catch (error) {
            console.error(
              `Failed to create Stripe customer for user ${user.id}:`,
              error,
            );
          }
        }),
      );
    }

    for (const organization of organizationsWithoutStripeCustomer) {
      if (
        shouldStopSync(
          options,
          "Stopping before scheduling more organization sync operations",
        )
      ) {
        break;
      }

      runningSyncPromises.push(
        limit(async () => {
          if (
            shouldStopSync(
              options,
              `Stopping before processing organization ${organization.id}`,
            )
          ) {
            return;
          }

          try {
            await createStripeCustomerForOrganization(organization.id, options);
          } catch (error) {
            console.error(
              `Failed to create Stripe customer for organization ${organization.id}:`,
              error,
            );
          }
        }),
      );
    }

    await Promise.allSettled(runningSyncPromises);
  },
};
