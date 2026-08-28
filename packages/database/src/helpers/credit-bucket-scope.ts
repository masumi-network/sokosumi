import {
  CreditBucketReferenceType,
  Prisma,
} from "../generated/prisma/client.js";
import { memberRepository } from "../repositories/member.repository.js";
import { resolveOrganizationBillingPlan } from "./organization-billing-plan.js";

const ENTERPRISE_POOL_REFERENCE_TYPES = [
  CreditBucketReferenceType.ENTERPRISE_PERIOD,
  CreditBucketReferenceType.ENTERPRISE_TOP_UP,
] as const;

const NON_SUBSCRIPTION_SHARED_REFERENCE_TYPES = [
  CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
  ...ENTERPRISE_POOL_REFERENCE_TYPES,
] as const;

export interface PersonalCreditBucketScopeContext {
  workspace: "personal";
  userId: string;
}

export type OrganizationCreditPoolAccess = "none" | "shared" | "enterprise";

export interface OrganizationCreditBucketScopeContext {
  workspace: "organization";
  userId: string;
  organizationId: string;
  poolAccess: OrganizationCreditPoolAccess;
}

export type CreditBucketScopeContext =
  | PersonalCreditBucketScopeContext
  | OrganizationCreditBucketScopeContext;

export async function resolveCreditBucketScopeContext(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<CreditBucketScopeContext> {
  if (!organizationId) {
    return {
      workspace: "personal",
      userId,
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

  let poolAccess: OrganizationCreditPoolAccess = "none";
  if (!requiresAssignedSeat && member != null) {
    poolAccess = "shared";
  } else if (hasAssignedSeat && isConsumableEnterprise) {
    poolAccess = "enterprise";
  } else if (hasAssignedSeat) {
    poolAccess = "shared";
  }

  return {
    workspace: "organization",
    userId,
    organizationId,
    poolAccess,
  };
}

export async function hasAssignedOrganizationSeat(
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
  if (context.workspace === "personal") {
    return true;
  }
  return context.poolAccess !== "none";
}

function unsatisfiableOrganizationScopeWhere(
  organizationId: string,
): Prisma.CreditBucketWhereInput {
  // CreditBucket.id is never "". Prisma forbids OR: [].
  return {
    organizationId,
    id: { equals: "" },
  };
}

function unsatisfiableOrganizationScopeSql(organizationId: string): Prisma.Sql {
  return Prisma.sql`cb."organizationId" = ${organizationId} AND FALSE`;
}

function buildOrganizationSharedScopeOr(
  includeEnterprise: boolean,
): Prisma.CreditBucketWhereInput[] {
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

  if (includeEnterprise) {
    sharedBranches.push({
      referenceType: {
        in: [...ENTERPRISE_POOL_REFERENCE_TYPES],
      },
    });
  }

  return sharedBranches;
}

function buildOrganizationSharedScopeSql(
  includeEnterprise: boolean,
): Prisma.Sql {
  const enterprisePoolSql = includeEnterprise
    ? Prisma.sql`
        OR (
          cb."referenceType" IN (
            ${CreditBucketReferenceType.ENTERPRISE_PERIOD},
            ${CreditBucketReferenceType.ENTERPRISE_TOP_UP}
          )
        )`
    : Prisma.sql``;

  return Prisma.sql`(
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
    ${enterprisePoolSql}
  )`;
}

export function buildCreditBucketScopeWhere(
  context: CreditBucketScopeContext,
): Prisma.CreditBucketWhereInput {
  if (context.workspace === "personal") {
    return {
      userId: context.userId,
      organizationId: null,
    };
  }

  if (context.poolAccess === "none") {
    return unsatisfiableOrganizationScopeWhere(context.organizationId);
  }

  return {
    organizationId: context.organizationId,
    OR: buildOrganizationSharedScopeOr(context.poolAccess === "enterprise"),
  };
}

export function buildCreditBucketScopeSql(
  context: CreditBucketScopeContext,
): Prisma.Sql {
  if (context.workspace === "personal") {
    return Prisma.sql`cb."userId" = ${context.userId} AND cb."organizationId" IS NULL`;
  }

  if (context.poolAccess === "none") {
    return unsatisfiableOrganizationScopeSql(context.organizationId);
  }

  return Prisma.sql`
    cb."organizationId" = ${context.organizationId}
    AND ${buildOrganizationSharedScopeSql(context.poolAccess === "enterprise")}
  `;
}

export function buildEnterprisePoolScopeWhere(
  context: CreditBucketScopeContext,
): Prisma.CreditBucketWhereInput | null {
  if (
    context.workspace !== "organization" ||
    context.poolAccess !== "enterprise"
  ) {
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
  if (
    context.workspace !== "organization" ||
    context.poolAccess !== "enterprise"
  ) {
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
