import {
  CreditBucketReferenceType,
  Prisma,
} from "../generated/prisma/client.js";
import {
  escapeStringForLike,
  getOrganizationMemberSubscriptionReferencePrefix,
  getOrganizationMemberSubscriptionReferencePrefixForStartsWith,
} from "./credit.js";

/**
 * Ownership scope for credit bucket reads and consumption in an organization.
 * Phase 5b extends this to gate ENTERPRISE_* buckets on seat assignment.
 */
export function buildCreditBucketScopeWhere(
  userId: string,
  organizationId: string | null,
): Prisma.CreditBucketWhereInput {
  if (!organizationId) {
    return {
      userId,
      organizationId: null,
    };
  }

  return {
    organizationId,
    OR: [
      {
        referenceType: null,
      },
      {
        referenceType: {
          not: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        },
      },
      {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        userId,
        referenceId: {
          startsWith:
            getOrganizationMemberSubscriptionReferencePrefixForStartsWith(
              userId,
            ),
        },
      },
    ],
  };
}

export function buildCreditBucketScopeSql(
  userId: string,
  organizationId: string | null,
): Prisma.Sql {
  if (!organizationId) {
    return Prisma.sql`cb."userId" = ${userId} AND cb."organizationId" IS NULL`;
  }

  const escapedPrefix = escapeStringForLike(
    getOrganizationMemberSubscriptionReferencePrefix(userId),
  );
  const memberReferencePattern = `${escapedPrefix}%`;
  return Prisma.sql`
    cb."organizationId" = ${organizationId}
    AND (
      cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
      OR (
        cb."referenceType" = ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
        AND cb."userId" = ${userId}
        AND cb."referenceId" LIKE ${memberReferencePattern} ESCAPE '\\'
      )
    )
  `;
}
