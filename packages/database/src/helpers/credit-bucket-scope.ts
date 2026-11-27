import { parseSelfServeSubscriptionPlanName } from "@sokosumi/utils";
import {
  CreditBucketReferenceType,
  EnterpriseContractStatus,
  Prisma,
} from "../generated/prisma/client.js";
import { memberRepository } from "../repositories/member.repository.js";
import { sharedTable, sharedType } from "../sql-tables.js";
import type { CreditDb, RawSqlDb, SharedDb } from "../types/shared-db.js";
import { isEnterpriseContractConsumable } from "./enterprise-contract.js";
import { resolveOrganizationBillingPlan } from "./organization-billing-plan.js";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "./subscription.js";

export interface PersonalCreditBucketScopeContext {
  workspace: "personal";
  userId: string;
}

export type OrganizationCreditPoolAccess = "none" | "shared" | "enterprise";

export interface OrganizationCreditBucketScopeContext {
  workspace: "organization";
  /**
   * The member charged. Null charges the Organization pool with no member,
   * for work without an Owner (ADR 0057); no Seat applies.
   */
  userId: string | null;
  organizationId: string;
  poolAccess: OrganizationCreditPoolAccess;
}

/**
 * The Project a charge or balance read is for. Without one, Organization scope
 * sees only buckets with no Project; with one, it also sees that Project's
 * credits (ADR 0067). Personal scope ignores it.
 */
export interface CreditBucketProjectOption {
  projectId?: string | null;
}

export type CreditBucketScopeContext =
  | PersonalCreditBucketScopeContext
  | OrganizationCreditBucketScopeContext;

export async function resolveCreditBucketScopeContext(
  userId: string | null,
  organizationId: string | null,
  tx: SharedDb,
  now: Date = new Date(),
): Promise<CreditBucketScopeContext> {
  if (!organizationId) {
    if (userId === null) {
      throw new Error("A personal credit balance needs a user");
    }
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
  const isConsumableEnterprise = isConsumableEnterprisePlan(billingPlan);
  const requiresAssignedSeat =
    billingPlan.mode === "enterprise_contract" ||
    (billingPlan.mode === "self_serve" && billingPlan.plan !== "free");

  const rules = { isConsumableEnterprise, requiresAssignedSeat };

  if (userId === null) {
    return {
      workspace: "organization",
      userId,
      organizationId,
      poolAccess: memberlessPoolAccess(rules),
    };
  }

  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    userId,
    organizationId,
    tx,
  );

  return {
    workspace: "organization",
    userId,
    organizationId,
    poolAccess: memberPoolAccess(rules, member),
  };
}

/** What an Organization's plan means for its pool, however it was read. */
interface OrganizationPoolRules {
  isConsumableEnterprise: boolean;
  requiresAssignedSeat: boolean;
}

function memberlessPoolAccess(
  rules: OrganizationPoolRules,
): OrganizationCreditPoolAccess {
  return rules.isConsumableEnterprise ? "enterprise" : "shared";
}

function memberPoolAccess(
  rules: OrganizationPoolRules,
  member: { seatAssignedAt: Date | null } | null,
): OrganizationCreditPoolAccess {
  const hasAssignedSeat = member?.seatAssignedAt != null;
  if (!rules.requiresAssignedSeat && member != null) return "shared";
  if (hasAssignedSeat && rules.isConsumableEnterprise) return "enterprise";
  return hasAssignedSeat ? "shared" : "none";
}

/**
 * The scope context on a transaction of either side. The caller names the
 * side its transaction has and never picks a reading: this is the one place
 * that does.
 *
 * THE TWO READINGS MUST STAY EQUAL. The shared side reads the plan and the
 * Seat through models (`resolveCreditBucketScopeContext`); a Network side
 * reads the same rows in raw SQL (`resolveCreditBucketScopeContextInSql`),
 * because that connection's models name the Network's schema. A rule changed
 * in one reading (which contract or subscription counts, what a Seat is) must
 * be changed in the other. Core's
 * `src/lib/credits/spend-transaction-sides.postgres.test.ts` proves they
 * agree, on PostgreSQL, for each kind of plan and payer: add the new case
 * there, and it fails for the copy that was missed.
 */
export async function resolveCreditBucketScopeContextOn(
  userId: string | null,
  organizationId: string | null,
  db: CreditDb,
  now: Date = new Date(),
): Promise<CreditBucketScopeContext> {
  return "shared" in db
    ? await resolveCreditBucketScopeContext(
        userId,
        organizationId,
        db.shared,
        now,
      )
    : await resolveCreditBucketScopeContextInSql(
        userId,
        organizationId,
        db.network,
        now,
      );
}

/**
 * The raw SQL reading: it repeats the rules of `resolveOrganizationBillingPlan`,
 * of the active subscription in `subscriptionRepository`, and of the member
 * lookup. Reached only through `resolveCreditBucketScopeContextOn`.
 */
async function resolveCreditBucketScopeContextInSql(
  userId: string | null,
  organizationId: string | null,
  tx: RawSqlDb,
  now: Date = new Date(),
): Promise<CreditBucketScopeContext> {
  if (!organizationId) {
    if (userId === null) {
      throw new Error("A personal credit balance needs a user");
    }
    return { workspace: "personal", userId };
  }

  const rules = await organizationPoolRulesInSql(organizationId, tx, now);
  if (userId === null) {
    return {
      workspace: "organization",
      userId,
      organizationId,
      poolAccess: memberlessPoolAccess(rules),
    };
  }

  const [member] = await tx.$queryRaw<{ seatAssignedAt: Date | null }[]>`
    SELECT "seatAssignedAt" FROM ${sharedTable("member")}
    WHERE "userId" = ${userId} AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  return {
    workspace: "organization",
    userId,
    organizationId,
    poolAccess: memberPoolAccess(rules, member ?? null),
  };
}

async function organizationPoolRulesInSql(
  organizationId: string,
  tx: RawSqlDb,
  now: Date,
): Promise<OrganizationPoolRules> {
  const [contract] = await tx.$queryRaw<
    { activatedAt: Date; periodCount: number }[]
  >`
    SELECT "activatedAt", "periodCount" FROM ${sharedTable("enterprise_contract")}
    WHERE "organizationId" = ${organizationId}
      AND status = ${EnterpriseContractStatus.active}::${sharedType("EnterpriseContractStatus")}
      AND "activatedAt" IS NOT NULL
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `;
  if (contract) {
    return {
      isConsumableEnterprise: isEnterpriseContractConsumable({
        activatedAt: contract.activatedAt,
        now,
        periodCount: contract.periodCount,
        status: EnterpriseContractStatus.active,
      }),
      requiresAssignedSeat: true,
    };
  }

  const active = Prisma.sql`"referenceId" = ${organizationId}
      AND status IN (${Prisma.join([...ACTIVE_SUBSCRIPTION_STATUSES])})`;
  // The period that contains now, a Stripe-backed row first.
  let [subscription] = await tx.$queryRaw<{ plan: string }[]>`
    SELECT plan FROM ${sharedTable("subscription")}
    WHERE ${active} AND "periodStart" <= ${now} AND "periodEnd" > ${now}
    ORDER BY (COALESCE("stripeSubscriptionId", '') = '') ASC, "updatedAt" DESC
    LIMIT 1
  `;
  if (!subscription) {
    // Else the latest period that has started.
    [subscription] = await tx.$queryRaw<{ plan: string }[]>`
      SELECT plan FROM ${sharedTable("subscription")}
      WHERE ${active} AND ("periodStart" IS NULL OR "periodStart" <= ${now})
      ORDER BY "periodEnd" DESC NULLS LAST, "updatedAt" DESC
      LIMIT 1
    `;
  }
  const plan = subscription
    ? (parseSelfServeSubscriptionPlanName(subscription.plan) ?? "free")
    : "free";
  return {
    isConsumableEnterprise: false,
    requiresAssignedSeat: plan !== "free",
  };
}

function isConsumableEnterprisePlan(
  billingPlan: Awaited<ReturnType<typeof resolveOrganizationBillingPlan>>,
): boolean {
  return billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable;
}

/**
 * The pool a seated member of the Organization draws from, read without any
 * member. Only for questions about the pool itself (is it empty?), never to
 * authorize spend: spend stays gated by `resolveCreditBucketScopeContext`.
 */
export async function buildOrganizationPoolScopeSql(
  organizationId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
  { projectId }: CreditBucketProjectOption = {},
): Promise<Prisma.Sql> {
  const billingPlan = await resolveOrganizationBillingPlan(
    organizationId,
    tx,
    now,
  );
  return organizationPoolSql(
    organizationId,
    isConsumableEnterprisePlan(billingPlan),
    projectId,
  );
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

function unsatisfiableOrganizationScopeSql(organizationId: string): Prisma.Sql {
  return Prisma.sql`cb."organizationId" = ${organizationId} AND FALSE`;
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

export function buildCreditBucketScopeSql(
  context: CreditBucketScopeContext,
  { projectId }: CreditBucketProjectOption = {},
): Prisma.Sql {
  if (context.workspace === "personal") {
    return Prisma.sql`cb."userId" = ${context.userId} AND cb."organizationId" IS NULL`;
  }

  if (context.poolAccess === "none") {
    return unsatisfiableOrganizationScopeSql(context.organizationId);
  }

  return organizationPoolSql(
    context.organizationId,
    context.poolAccess === "enterprise",
    projectId,
  );
}

function organizationPoolSql(
  organizationId: string,
  includeEnterprise: boolean,
  projectId: string | null | undefined,
): Prisma.Sql {
  const projectSql = projectId
    ? Prisma.sql`(cb."projectId" IS NULL OR cb."projectId" = ${projectId})`
    : Prisma.sql`cb."projectId" IS NULL`;
  return Prisma.sql`
    cb."organizationId" = ${organizationId}
    AND ${projectSql}
    AND ${buildOrganizationSharedScopeSql(includeEnterprise)}
  `;
}

/**
 * The spend order as a whole ORDER BY clause: soonest expiry, smallest
 * original amount, oldest, then id. Spend order key: the charge's Project
 * credits before the pool (ADR 0067).
 */
export function creditBucketSpendOrderSql(
  projectId: string | null | undefined,
): Prisma.Sql {
  const order = Prisma.sql`"expiresAt" ASC NULLS LAST, amount ASC, "createdAt" ASC, id ASC`;
  return projectId
    ? Prisma.sql`ORDER BY ("projectId" IS NULL) ASC, ${order}`
    : Prisma.sql`ORDER BY ${order}`;
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
