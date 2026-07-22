import { CreditBucketReferenceType } from "../../src/generated/prisma/client.js";
import { buildFreeCreditReferenceId } from "../../src/helpers/credit.js";
import { grantFreeCredits } from "../../src/helpers/free-credits.js";
import { grantSignupBonusCredits } from "../../src/helpers/signup-bonus-credits.js";
import type { SeedContext } from "./context.js";
import { SEED_SUBSCRIPTION_IDS } from "./fixtures.js";

const LOVELACE_UNIT = "lovelace";

export async function seedBilling(ctx: SeedContext): Promise<void> {
  const { prisma, now, users, orgs } = ctx;

  await prisma.creditCost.upsert({
    where: { unit: LOVELACE_UNIT },
    create: { unit: LOVELACE_UNIT, centsPerUnit: 1n },
    update: { centsPerUnit: 1n },
  });

  const periodStart = new Date(now);
  const periodEnd = new Date(now);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: SEED_SUBSCRIPTION_IDS.alicePro },
    create: {
      plan: "pro",
      referenceId: users.alice.id,
      status: "active",
      billingInterval: "month",
      periodStart,
      periodEnd,
      stripeSubscriptionId: SEED_SUBSCRIPTION_IDS.alicePro,
    },
    update: {
      plan: "pro",
      referenceId: users.alice.id,
      status: "active",
      billingInterval: "month",
      periodStart,
      periodEnd,
    },
  });

  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: SEED_SUBSCRIPTION_IDS.acmeStarter },
    create: {
      plan: "starter",
      referenceId: orgs.acme.id,
      status: "active",
      billingInterval: "month",
      periodStart,
      periodEnd,
      seats: 5,
      stripeSubscriptionId: SEED_SUBSCRIPTION_IDS.acmeStarter,
    },
    update: {
      plan: "starter",
      referenceId: orgs.acme.id,
      status: "active",
      billingInterval: "month",
      periodStart,
      periodEnd,
      seats: 5,
    },
  });

  await prisma.$transaction(async (tx) => {
    await grantSignupBonusCredits(
      {
        credits: 5000,
        expiresAt: null,
        userId: users.alice.id,
      },
      tx,
    );

    await grantSignupBonusCredits(
      {
        credits: 500,
        expiresAt: null,
        userId: users.bob.id,
      },
      tx,
    );

    const orgFreeReferenceId = buildFreeCreditReferenceId({
      grantId: "seed-acme-org-credits",
      targetId: orgs.acme.id,
      targetType: "organization",
    });
    const existingOrgBucket = await tx.creditBucket.findUnique({
      where: {
        referenceId_referenceType: {
          referenceId: orgFreeReferenceId,
          referenceType: CreditBucketReferenceType.FREE,
        },
      },
    });

    if (!existingOrgBucket) {
      await grantFreeCredits(
        {
          credits: 2000,
          expiresAt: null,
          grantId: "seed-acme-org-credits",
          organizationId: orgs.acme.id,
          referenceNote: "Local seed org credits",
          targetId: orgs.acme.id,
          targetType: "organization",
          transactionUserId: users.alice.id,
        },
        tx,
      );
    }
  });
}
