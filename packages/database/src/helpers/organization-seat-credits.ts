import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import {
  buildOrganizationMemberSubscriptionReferenceId,
  ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
} from "./credit.js";
import { resolvePurchasedSeats } from "./organization-seats.js";
import { LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS } from "./subscription.js";

export function buildOrganizationSeatAssignmentSubscriptionReferenceId(
  userId: string,
  organizationId: string,
  periodEnd: Date,
): string {
  return buildOrganizationMemberSubscriptionReferenceId(
    userId,
    `seat-assign:${organizationId}:${periodEnd.toISOString()}`,
  );
}

/**
 * Counts organization members that already hold a paid subscription-period
 * credit bucket that has not expired yet (i.e. belongs to the current period).
 *
 * Matching by "not yet expired" rather than an exact `expiresAt === periodEnd`
 * avoids coupling to the exact timestamp the Stripe integration stored on the
 * local subscription: invoice-granted buckets and the local
 * `Subscription.periodEnd` come from different writers and may drift by edge
 * cases (proration, event ordering). Previous-period buckets expire at the
 * prior period end (<= now) and are therefore excluded.
 */
export async function countOrganizationSubscriptionPeriodSeatGrants(
  organizationId: string,
  now: Date,
  tx: Prisma.TransactionClient,
): Promise<number> {
  return await tx.creditBucket.count({
    where: {
      organizationId,
      expiresAt: {
        gt: now,
      },
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      referenceId: {
        startsWith: ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
      },
      // Free-tier grants share the member prefix but must not count as used
      // paid seats.
      NOT: {
        referenceId: {
          contains: LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS,
        },
      },
    },
  });
}

export async function hasOrganizationMemberSubscriptionPeriodGrant(
  organizationId: string,
  userId: string,
  now: Date,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const existingBucket = await tx.creditBucket.findFirst({
    where: {
      organizationId,
      expiresAt: {
        gt: now,
      },
      userId,
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      referenceId: {
        startsWith: `${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}${userId}:`,
      },
      // A held free-tier grant must not block a paid seat grant when the member
      // is later assigned a seat.
      NOT: {
        referenceId: {
          contains: LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS,
        },
      },
    },
    select: {
      id: true,
    },
  });

  return existingBucket !== null;
}

export function getUnusedSubscriptionSeatCreditSlots(params: {
  grantedSeatSlots: number;
  purchasedSeats: number | null | undefined;
}): number {
  const purchasedSeats = resolvePurchasedSeats(params.purchasedSeats);

  return Math.max(purchasedSeats - params.grantedSeatSlots, 0);
}
