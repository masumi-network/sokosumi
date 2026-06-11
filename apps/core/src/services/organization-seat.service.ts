import {
  CreditBucketReferenceType,
  type Prisma,
  TaskEventOrigin,
} from "@sokosumi/database";
import {
  buildOrganizationSeatAssignmentSubscriptionReferenceId,
  countOrganizationSubscriptionPeriodSeatGrants,
  ensureLocalFreeSubscriptionPeriod,
  FREE_SUBSCRIPTION_PLAN,
  fetchOrganizationMemberUserIds,
  getUnusedSubscriptionSeatCreditSlots,
  hasOrganizationMemberSubscriptionPeriodGrant,
  isActiveSubscriptionStatus,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import { convertCreditsToCents, TaskStatus } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { badRequest, notFound } from "@/helpers/error";
import { getSubscriptionSeatCredits } from "@/services/subscription-seat-credits.service";

export interface GrantUnusedSeatSubscriptionCreditsResult {
  creditsGranted: number;
  granted: boolean;
}

function isPrismaRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
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
    throw notFound("Member not found");
  }

  if (error.message.includes("exceeds purchased seats")) {
    throw badRequest(
      "No unused seats available. Purchase more seats or unassign another member.",
    );
  }

  throw error;
}

async function markOutOfCreditsTasksAsToppedUp(params: {
  organizationId: string;
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  const tasks = await params.tx.task.findMany({
    where: {
      organizationId: params.organizationId,
      status: TaskStatus.OUT_OF_CREDITS,
    },
    select: {
      id: true,
    },
  });

  for (const task of tasks) {
    try {
      await params.tx.task.update({
        where: {
          id: task.id,
          status: TaskStatus.OUT_OF_CREDITS,
        },
        data: {
          status: TaskStatus.CREDITS_TOPPED_UP,
          events: {
            create: {
              status: TaskStatus.CREDITS_TOPPED_UP,
              origin: TaskEventOrigin.SOKOSUMI,
              userId: params.userId,
              coworkerId: null,
            },
          },
        },
      });
    } catch (error) {
      if (isPrismaRecordNotFoundError(error)) {
        continue;
      }

      throw error;
    }
  }
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
