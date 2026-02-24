import pLimit from "p-limit";
import Stripe from "stripe";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const STRIPE_CUSTOMER_SYNC_CONCURRENCY = 5;

function createStripeClient(): Stripe {
  const env = getEnv();

  return new Stripe(env.STRIPE_SECRET_KEY);
}

async function createStripeCustomerForUser(
  stripe: Stripe,
  userId: string,
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

  await stripe.customers.create(
    {
      email: user.email,
      metadata: {
        customerType: "user",
        userId: user.id,
      },
      name: user.name,
    },
    {
      idempotencyKey: `user-${user.id}`,
    },
  );

  console.info(`Created Stripe customer for user ${user.id}`);
}

async function createStripeCustomerForOrganization(
  stripe: Stripe,
  organizationId: string,
): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      invoiceEmail: true,
      name: true,
      slug: true,
    },
  });

  if (!organization) {
    return;
  }

  await stripe.customers.create(
    {
      ...(organization.invoiceEmail
        ? { email: organization.invoiceEmail }
        : {}),
      metadata: {
        customerType: "organization",
        organizationId: organization.id,
        organizationSlug: organization.slug,
      },
      name: organization.name,
    },
    {
      idempotencyKey: `organization-${organization.id}`,
    },
  );

  console.info(`Created Stripe customer for organization ${organization.id}`);
}

export const stripeCustomerSyncService = {
  async syncAllStripeCustomers(): Promise<void> {
    const stripe = createStripeClient();

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
      "users and",
      organizationsWithoutStripeCustomer.length,
      "organizations without Stripe customers",
    );

    const userLimit = pLimit(STRIPE_CUSTOMER_SYNC_CONCURRENCY);
    const userSyncPromises: Promise<void>[] = [];
    for (const user of usersWithoutStripeCustomer) {
      userSyncPromises.push(
        userLimit(async () => {
          try {
            await createStripeCustomerForUser(stripe, user.id);
          } catch (error) {
            console.error(
              `Failed to create Stripe customer for user ${user.id}:`,
              error,
            );
          }
        }),
      );
    }
    await Promise.allSettled(userSyncPromises);

    const organizationLimit = pLimit(STRIPE_CUSTOMER_SYNC_CONCURRENCY);
    const organizationSyncPromises: Promise<void>[] = [];
    for (const organization of organizationsWithoutStripeCustomer) {
      organizationSyncPromises.push(
        organizationLimit(async () => {
        try {
          await createStripeCustomerForOrganization(stripe, organization.id);
        } catch (error) {
          console.error(
            `Failed to create Stripe customer for organization ${organization.id}:`,
            error,
          );
        }
        }),
      );
    }
    await Promise.allSettled(organizationSyncPromises);
  },
};
