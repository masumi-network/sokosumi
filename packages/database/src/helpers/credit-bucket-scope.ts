import {
  CreditBucketReferenceType,
  Prisma,
} from "../generated/prisma/client.js";
import { memberRepository } from "../repositories/member.repository.js";
import {
  escapeStringForLike,
  getOrganizationMemberSubscriptionReferencePrefix,
  getOrganizationMemberSubscriptionReferencePrefixForStartsWith,
} from "./credit.js";
import { resolveOrganizationBillingPlan } from "./organization-billing-plan.js";

const ENTERPRISE_POOL_REFERENCE_TYPES = [
  CreditBucketReferenceType.ENTERPRISE_PERIOD,
  CreditBucketReferenceType.ENTERPRISE_TOP_UP,
] as const;

const NON_SUBSCRIPTION_SHARED_REFERENCE_TYPES = [
  CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
  ...ENTERPRISE_POOL_REFERENCE_TYPES,
] as const;

export interface CreditBucketScopeContext {
  userId: string;
  organizationId: string | null;
  canAccessOrganizationSharedCredits: boolean;
  canAccessEnterprisePool: boolean;
}

export async function resolveCreditBucketScopeContext(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<CreditBucketScopeContext> {
  if (!organizationId) {
    return {
      userId,
      organizationId: null,
      canAccessOrganizationSharedCredits: true,
      canAccessEnterprisePool: false,
    };
  }

  const billingPlan = await resolveOrganizationBillingPlan(
    organizationId,
    tx,
    now,
  );
  const isConsumableEnterprise =
    billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable;
  const requiresAssignedSeat =
    billingPlan.mode === "enterprise_contract" ||
    (billingPlan.mode === "self_serve" && billingPlan.plan !== "free");

  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    userId,
    organizationId,
    tx,
  );
  const hasAssignedSeat = member?.seatAssignedAt != null;

  return {
    userId,
    organizationId,
    canAccessOrganizationSharedCredits: requiresAssignedSeat
      ? hasAssignedSeat
      : member != null,
    canAccessEnterprisePool: isConsumableEnterprise && hasAssignedSeat,
  };
}

export async function canUseOrganizationWorkstation(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  if (!organizationId) {
    return true;
  }

  const context = await resolveCreditBucketScopeContext(
    userId,
    organizationId,
    tx,
  );
  return context.canAccessOrganizationSharedCredits;
}

function buildMemberSubscriptionScopeWhere(
  userId: string,
): Prisma.CreditBucketWhereInput {
  return {
    referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
    userId,
    referenceId: {
      startsWith:
        getOrganizationMemberSubscriptionReferencePrefixForStartsWith(userId),
    },
  };
}

function buildOrganizationScopeOr(
  context: CreditBucketScopeContext,
): Prisma.CreditBucketWhereInput[] {
  const branches: Prisma.CreditBucketWhereInput[] = [
    buildMemberSubscriptionScopeWhere(context.userId),
  ];

  if (!context.canAccessOrganizationSharedCredits) {
    return branches;
  }

  const sharedBranches: Prisma.CreditBucketWhereInput[] = [
    {
      referenceType: null,
    },
    {
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      userId: null,
    },
    {
      referenceType: {
        notIn: [...NON_SUBSCRIPTION_SHARED_REFERENCE_TYPES],
      },
    },
  ];

  if (context.canAccessEnterprisePool) {
    sharedBranches.push({
      referenceType: {
        in: [...ENTERPRISE_POOL_REFERENCE_TYPES],
      },
    });
  }

  return [...branches, ...sharedBranches];
}

export function buildCreditBucketScopeWhere(
  context: CreditBucketScopeContext,
): Prisma.CreditBucketWhereInput {
  if (!context.organizationId) {
    return {
      userId: context.userId,
      organizationId: null,
    };
  }

  return {
    organizationId: context.organizationId,
    OR: buildOrganizationScopeOr(context),
  };
}

export function buildCreditBucketScopeSql(
  context: CreditBucketScopeContext,
): Prisma.Sql {
  if (!context.organizationId) {
    return Prisma.sql`cb."userId" = ${context.userId} AND cb."organizationId" IS NULL`;
  }

  const escapedPrefix = escapeStringForLike(
    getOrganizationMemberSubscriptionReferencePrefix(context.userId),
  );
  const memberReferencePattern = `${escapedPrefix}%`;

  const sharedCreditsSql = context.canAccessOrganizationSharedCredits
    ? Prisma.sql`
        OR (
          cb."referenceType" IS NULL
          OR (
            cb."referenceType" = ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
            AND cb."userId" IS NULL
          )
          OR (
            cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
            AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.ENTERPRISE_PERIOD}
            AND cb."referenceType" IS DISTINCT FROM ${CreditBucketReferenceType.ENTERPRISE_TOP_UP}
          )
        )`
    : Prisma.sql``;

  const enterprisePoolSql = context.canAccessEnterprisePool
    ? Prisma.sql`
        OR (
          cb."referenceType" IN (
            ${CreditBucketReferenceType.ENTERPRISE_PERIOD},
            ${CreditBucketReferenceType.ENTERPRISE_TOP_UP}
          )
        )`
    : Prisma.sql``;

  return Prisma.sql`
    cb."organizationId" = ${context.organizationId}
    AND (
      (
        cb."referenceType" = ${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}
        AND cb."userId" = ${context.userId}
        AND cb."referenceId" LIKE ${memberReferencePattern} ESCAPE '\\'
      )
      ${sharedCreditsSql}
      ${enterprisePoolSql}
    )
  `;
}

export function buildEnterprisePoolScopeWhere(
  context: CreditBucketScopeContext,
): Prisma.CreditBucketWhereInput | null {
  if (!context.organizationId || !context.canAccessEnterprisePool) {
    return null;
  }

  return {
    organizationId: context.organizationId,
    referenceType: {
      in: [...ENTERPRISE_POOL_REFERENCE_TYPES],
    },
  };
}

export function buildEnterprisePoolScopeSql(
  context: CreditBucketScopeContext,
): Prisma.Sql | null {
  if (!context.organizationId || !context.canAccessEnterprisePool) {
    return null;
  }

  return Prisma.sql`
    cb."organizationId" = ${context.organizationId}
    AND cb."referenceType" IN (
      ${CreditBucketReferenceType.ENTERPRISE_PERIOD},
      ${CreditBucketReferenceType.ENTERPRISE_TOP_UP}
    )
  `;
}
