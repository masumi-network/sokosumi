import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import {
  buildOrganizationSeatAssignmentSubscriptionReferenceId,
  countOrganizationSubscriptionPeriodSeatGrants,
  ensureLocalFreeSubscriptionPeriod,
  FREE_SUBSCRIPTION_PLAN,
  fetchOrganizationMemberUserIds,
  getUnusedSubscriptionSeatCreditSlots,
  grantFreeOrganizationMemberSubscriptionCredits,
  hasOrganizationMemberSubscriptionPeriodGrant,
  isActiveSubscriptionStatus,
  resolveOrganizationBillingPlan,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS, convertCreditsToCents } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { badRequest, notFound } from "@/helpers/error";
import { getSubscriptionSeatCredits } from "@/services/subscription-seat-credits.service";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

export interface GrantUnusedSeatSubscriptionCreditsResult {
  creditsGranted: number;
  granted: boolean;
}

/**
 * Maps member-repository seat errors to HTTP exceptions; rethrows everything
 * else (including HTTP exceptions thrown by guards inside the transaction).
 */
export function mapSeatRepositoryError(error: unknown): never {
  if (error instanceof HTTPException || !(error instanceof Error)) {
    throw error;
  }

  if (error.message === "Member not found") {
    throw notFound("Member not found", {
      kind: CORE_API_ERROR_KINDS.MEMBER_NOT_FOUND,
    });
  }

  if (error.message.includes("exceeds purchased seats")) {
    throw badRequest(
      "No unused seats available. Purchase more seats or unassign another member.",
      { kind: CORE_API_ERROR_KINDS.SEAT_CAPACITY_EXCEEDED },
    );
  }

  throw error;
}

async function resolveCreditsPerSeatForSubscription(
  plan: string,
): Promise<number | null> {
  if (plan === "starter" || plan === "standard" || plan === "pro") {
    const seatCredits = await getSubscriptionSeatCredits();
    return seatCredits[plan];
  }

  return null;
}

export async function grantUnusedSeatSubscriptionCreditsIfEligible(
  organizationId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<GrantUnusedSeatSubscriptionCreditsResult> {
  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      tx,
    );

  if (
    !subscription?.stripeSubscriptionId ||
    !subscription.periodEnd ||
    !isActiveSubscriptionStatus(subscription.status) ||
    subscription.plan === FREE_SUBSCRIPTION_PLAN
  ) {
    return { creditsGranted: 0, granted: false };
  }

  const periodEnd = subscription.periodEnd;
  const purchasedSeats = resolvePurchasedSeats(subscription.seats);
  const now = new Date();

  if (periodEnd <= now) {
    return { creditsGranted: 0, granted: false };
  }

  const [grantedSeatSlots, memberAlreadyHasGrant, creditsPerSeat] =
    await Promise.all([
      countOrganizationSubscriptionPeriodSeatGrants(organizationId, now, tx),
      hasOrganizationMemberSubscriptionPeriodGrant(
        organizationId,
        userId,
        now,
        tx,
      ),
      resolveCreditsPerSeatForSubscription(subscription.plan),
    ]);

  if (memberAlreadyHasGrant || creditsPerSeat === null || creditsPerSeat <= 0) {
    return { creditsGranted: 0, granted: false };
  }

  const unusedSeatCreditSlots = getUnusedSubscriptionSeatCreditSlots({
    grantedSeatSlots,
    purchasedSeats,
  });

  if (unusedSeatCreditSlots <= 0) {
    return { creditsGranted: 0, granted: false };
  }

  const referenceId = buildOrganizationSeatAssignmentSubscriptionReferenceId(
    userId,
    organizationId,
    periodEnd,
  );
  const existingBucket = await tx.creditBucket.findUnique({
    where: {
      referenceId_referenceType: {
        referenceId,
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      },
    },
    select: {
      id: true,
    },
  });

  if (existingBucket) {
    return { creditsGranted: 0, granted: false };
  }

  const cents = convertCreditsToCents(creditsPerSeat);
  await tx.transaction.create({
    data: {
      amount: cents,
      organization: {
        connect: {
          id: organizationId,
        },
      },
      sourceCreditBucket: {
        create: {
          amount: cents,
          expiresAt: periodEnd,
          organizationId,
          referenceId,
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          userId,
        },
      },
      user: {
        connect: {
          id: userId,
        },
      },
    },
  });

  await markOutOfCreditsTasksAsToppedUp({
    organizationId,
    tx,
    userId,
  });

  console.log(
    `✅ Granted ${creditsPerSeat} unused-seat subscription credits to organization ${organizationId} member ${userId} for period ending ${periodEnd.toISOString()}`,
  );

  return {
    creditsGranted: creditsPerSeat,
    granted: true,
  };
}

export async function unassignOrganizationMemberSeatWithCreditSync(
  organizationId: string,
  memberId: string,
  tx: Prisma.TransactionClient,
): Promise<{ memberId: string }> {
  const billingPlan = await resolveOrganizationBillingPlan(organizationId, tx);
  const member = await memberRepository.unassignSeat(
    memberId,
    organizationId,
    tx,
  );

  if (billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable) {
    return {
      memberId: member.id,
    };
  }

  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      tx,
    );

  if (
    subscription?.stripeSubscriptionId &&
    subscription.periodEnd &&
    subscription.plan !== FREE_SUBSCRIPTION_PLAN &&
    isActiveSubscriptionStatus(subscription.status)
  ) {
    await grantFreeOrganizationMemberSubscriptionCredits(
      {
        memberUserIds: [member.userId],
        organizationId,
        periodEnd: subscription.periodEnd,
      },
      tx,
    );
  } else if (subscription?.periodStart && subscription.periodEnd) {
    await syncLocalFreeOrganizationCreditsIfNeeded(
      organizationId,
      {
        createdAt: subscription.createdAt,
        periodEnd: subscription.periodEnd,
        periodStart: subscription.periodStart,
        seats: subscription.seats,
        status: subscription.status,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      },
      tx,
    );
  }

  return {
    memberId: member.id,
  };
}

export async function syncLocalFreeOrganizationCreditsIfNeeded(
  organizationId: string,
  subscription: {
    createdAt: Date;
    periodEnd: Date;
    periodStart: Date;
    seats: number | null;
    status: string;
    stripeSubscriptionId: string | null;
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (
    subscription.stripeSubscriptionId ||
    !isActiveSubscriptionStatus(subscription.status)
  ) {
    return;
  }

  const memberUserIds = await fetchOrganizationMemberUserIds(
    organizationId,
    tx,
  );

  await ensureLocalFreeSubscriptionPeriod(
    {
      billingAnchorDate: subscription.createdAt,
      memberUserIds,
      organizationId,
      periodEnd: subscription.periodEnd,
      periodStart: subscription.periodStart,
      purchasedSeats: resolvePurchasedSeats(subscription.seats),
      referenceId: organizationId,
    },
    tx,
  );
}
