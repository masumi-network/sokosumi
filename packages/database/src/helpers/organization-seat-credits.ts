import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import {
  buildOrganizationMemberSubscriptionReferenceId,
  creditBucketActivatesAtOrBefore,
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

export async function countOrganizationSubscriptionPeriodSeatGrants(
  organizationId: string,
  now: Date,
  tx: Prisma.TransactionClient,
): Promise<number> {
  return await tx.creditBucket.count({
    where: {
      AND: [
        creditBucketActivatesAtOrBefore(now),
        {
          organizationId,
          expiresAt: {
            gt: now,
          },
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          referenceId: {
            startsWith: ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
          },
          NOT: {
            referenceId: {
              contains: LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS,
            },
          },
        },
      ],
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
      AND: [
        creditBucketActivatesAtOrBefore(now),
        {
          organizationId,
          expiresAt: {
            gt: now,
          },
          userId,
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          referenceId: {
            startsWith: `${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}${userId}:`,
          },
          NOT: {
            referenceId: {
              contains: LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS,
            },
          },
        },
      ],
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
