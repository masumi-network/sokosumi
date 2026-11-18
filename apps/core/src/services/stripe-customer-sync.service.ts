import pLimit from "p-limit";
import prisma from "@/lib/db/prisma";
import { createCoreLogger, emitCoreError } from "@/lib/evlog";
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

const OPERATION = "stripe_customer_sync";

/** Why the run stopped before every row was tried, if it did. */
function stopReason(
  options: SyncExecutionOptions,
): "cancelled" | "deadline" | null {
  if (!options.shouldContinue()) return "cancelled";
  if (!hasTimeRemaining(options.deadlineMs)) return "deadline";
  return null;
}

/**
 * Runs after the cron response (`waitUntil`), so each failure is its own
 * standalone event rather than a field on the finished request event.
 */
function logCreateFailure(
  owner: "user" | "organization",
  id: string,
  error: unknown,
): void {
  emitCoreError(
    { operation: OPERATION, [owner]: { id } },
    {
      message:
        owner === "user"
          ? "Could not create a Stripe customer for a user"
          : "Could not create a Stripe customer for an organization",
      why: "Stripe did not create the customer",
      fix: `The next stripe-customers sync retries this ${owner}. If it fails every run, read the Stripe error under error.cause and fix the ${owner}'s billing details or the Stripe configuration.`,
      cause: error,
    },
  );
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
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      id: true,
      name: true,
    },
  });

  if (!user) {
    return false;
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
  return true;
}

async function createStripeCustomerForOrganization(
  organizationId: string,
  options: SyncExecutionOptions,
): Promise<boolean> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });

  if (!organization) {
    return false;
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
  return true;
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

    const run = {
      pending: {
        users: usersWithoutStripeCustomer.length,
        organizations: organizationsWithoutStripeCustomer.length,
      },
      created: { users: 0, organizations: 0 },
      failed: { users: 0, organizations: 0 },
      stopped: null as "cancelled" | "deadline" | null,
    };
    const stop = () => {
      run.stopped ??= stopReason(options);
      return run.stopped !== null;
    };

    const limit = pLimit(STRIPE_CUSTOMER_SYNC_CONCURRENCY);
    const runningSyncPromises: Promise<void>[] = [];
    for (const user of usersWithoutStripeCustomer) {
      if (stop()) {
        break;
      }

      runningSyncPromises.push(
        limit(async () => {
          if (stop()) {
            return;
          }

          try {
            if (await createStripeCustomerForUser(user.id, options)) {
              run.created.users += 1;
            }
          } catch (error) {
            run.failed.users += 1;
            logCreateFailure("user", user.id, error);
          }
        }),
      );
    }

    for (const organization of organizationsWithoutStripeCustomer) {
      if (stop()) {
        break;
      }

      runningSyncPromises.push(
        limit(async () => {
          if (stop()) {
            return;
          }

          try {
            if (
              await createStripeCustomerForOrganization(
                organization.id,
                options,
              )
            ) {
              run.created.organizations += 1;
            }
          } catch (error) {
            run.failed.organizations += 1;
            logCreateFailure("organization", organization.id, error);
          }
        }),
      );
    }

    await Promise.allSettled(runningSyncPromises);
    createCoreLogger({ operation: OPERATION, stripeCustomerSync: run }).emit();
  },
};
