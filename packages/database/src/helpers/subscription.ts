import { convertCreditsToCents } from "@sokosumi/utils";
import { v4 as uuidv4 } from "uuid";
import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import {
  buildOrganizationMemberSubscriptionReferenceId,
  USER_CREDIT_REFERENCE_PREFIX,
} from "./credit.js";

export const ACTIVE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
] as const;

export const FREE_SUBSCRIPTION_MONTHLY_CREDITS = 250;
export const FREE_SUBSCRIPTION_PLAN = "free";
export const MONTHLY_BILLING_INTERVAL = "month";

interface LocalFreeSubscriptionGrant {
  credits: number;
  referenceId: string;
  userId: string;
}

interface EnsureLocalFreeSubscriptionPeriodBaseParams {
  periodEnd: Date;
  periodStart: Date;
  referenceId: string;
  stripeCustomerId?: null | string;
}

export interface EnsureLocalFreeUserSubscriptionPeriodParams
  extends EnsureLocalFreeSubscriptionPeriodBaseParams {
  organizationId: null;
  userId: string;
}

export interface EnsureLocalFreeOrganizationSubscriptionPeriodParams
  extends EnsureLocalFreeSubscriptionPeriodBaseParams {
  memberUserIds: string[];
  organizationId: string;
}

export type EnsureLocalFreeSubscriptionPeriodParams =
  | EnsureLocalFreeOrganizationSubscriptionPeriodParams
  | EnsureLocalFreeUserSubscriptionPeriodParams;

export interface EnsureLocalFreeSubscriptionPeriodResult {
  grantsCreated: number;
  subscriptionCreated: boolean;
  subscriptionId: string;
}

interface EnsureInitialLocalFreeSubscriptionPeriodBaseParams {
  createdAt: Date;
  stripeCustomerId: string;
}

export interface EnsureInitialLocalFreeUserSubscriptionPeriodParams
  extends EnsureInitialLocalFreeSubscriptionPeriodBaseParams {
  kind: "user";
  userId: string;
}

export interface EnsureInitialLocalFreeOrganizationSubscriptionPeriodParams
  extends EnsureInitialLocalFreeSubscriptionPeriodBaseParams {
  kind: "organization";
  organizationId: string;
}

export type EnsureInitialLocalFreeSubscriptionPeriodParams =
  | EnsureInitialLocalFreeOrganizationSubscriptionPeriodParams
  | EnsureInitialLocalFreeUserSubscriptionPeriodParams;

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function resolveSubscriptionPeriodStart(value: Date): Date {
  const periodStart = cloneDate(value);

  if (Number.isNaN(periodStart.getTime())) {
    throw new Error("Invalid subscription period start date");
  }

  return periodStart;
}

export function getNextMonthlyPeriodEnd(periodStart: Date): Date {
  const nextPeriodEnd = cloneDate(periodStart);
  nextPeriodEnd.setUTCMonth(nextPeriodEnd.getUTCMonth() + 1);
  return nextPeriodEnd;
}

export function isActiveSubscriptionStatus(status: string): boolean {
  return ACTIVE_SUBSCRIPTION_STATUSES.includes(
    status as (typeof ACTIVE_SUBSCRIPTION_STATUSES)[number],
  );
}

export function getSortedUniqueUserIds(userIds: string[]): string[] {
  return Array.from(
    new Set(userIds.filter((userId) => userId.trim().length > 0)),
  ).sort();
}

function isOrganizationSubscriptionPeriodParams(
  params: EnsureLocalFreeSubscriptionPeriodParams,
): params is EnsureLocalFreeOrganizationSubscriptionPeriodParams {
  return params.organizationId !== null;
}

export function buildLocalFreeUserSubscriptionReferenceId(
  userId: string,
  periodEnd: Date,
): string {
  return `${USER_CREDIT_REFERENCE_PREFIX}${userId}:local-free:${periodEnd.toISOString()}:subscription`;
}

export function buildLocalFreeOrganizationMemberSubscriptionReferenceId(
  userId: string,
  organizationId: string,
  periodEnd: Date,
): string {
  return buildOrganizationMemberSubscriptionReferenceId(
    userId,
    `local-free:${organizationId}:${periodEnd.toISOString()}`,
  );
}

function getOrganizationMemberUserIds(
  params: EnsureLocalFreeOrganizationSubscriptionPeriodParams,
): string[] {
  const memberUserIds = getSortedUniqueUserIds(params.memberUserIds);

  if (memberUserIds.length === 0) {
    throw new Error(
      `Cannot create local free subscription period for organization ${params.organizationId}: no members found`,
    );
  }

  return memberUserIds;
}

function normalizeLocalFreeSubscriptionPeriod(
  params: EnsureLocalFreeSubscriptionPeriodParams,
): {
  grants: LocalFreeSubscriptionGrant[];
  organizationId: null | string;
  seats: null | number;
} {
  if (!isOrganizationSubscriptionPeriodParams(params)) {
    return {
      grants: [
        {
          credits: FREE_SUBSCRIPTION_MONTHLY_CREDITS,
          referenceId: buildLocalFreeUserSubscriptionReferenceId(
            params.userId,
            params.periodEnd,
          ),
          userId: params.userId,
        },
      ],
      organizationId: null,
      seats: 1,
    };
  }

  const memberUserIds = getOrganizationMemberUserIds(params);

  return {
    grants: memberUserIds.map((userId) => ({
      credits: FREE_SUBSCRIPTION_MONTHLY_CREDITS,
      referenceId: buildLocalFreeOrganizationMemberSubscriptionReferenceId(
        userId,
        params.organizationId,
        params.periodEnd,
      ),
      userId,
    })),
    organizationId: params.organizationId,
    seats: memberUserIds.length,
  };
}

export async function ensureLocalFreeSubscriptionPeriod(
  params: EnsureLocalFreeSubscriptionPeriodParams,
  tx: Prisma.TransactionClient,
): Promise<EnsureLocalFreeSubscriptionPeriodResult> {
  const { grants, organizationId, seats } =
    normalizeLocalFreeSubscriptionPeriod(params);
  const existingSubscription = await tx.subscription.findFirst({
    where: {
      periodEnd: params.periodEnd,
      periodStart: params.periodStart,
      plan: FREE_SUBSCRIPTION_PLAN,
      referenceId: params.referenceId,
      stripeSubscriptionId: null,
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  let subscriptionId = existingSubscription?.id ?? "";
  let subscriptionCreated = false;

  if (!existingSubscription) {
    const createdSubscription = await tx.subscription.create({
      data: {
        billingInterval: MONTHLY_BILLING_INTERVAL,
        cancelAtPeriodEnd: false,
        id: uuidv4(),
        periodEnd: params.periodEnd,
        periodStart: params.periodStart,
        plan: FREE_SUBSCRIPTION_PLAN,
        referenceId: params.referenceId,
        seats,
        status: "active",
        stripeCustomerId: params.stripeCustomerId ?? null,
        stripeSubscriptionId: null,
      },
    });

    subscriptionId = createdSubscription.id;
    subscriptionCreated = true;
  }

  let grantsCreated = 0;
  for (const grant of grants) {
    const existingBucket = await tx.creditBucket.findUnique({
      where: {
        referenceId_referenceType: {
          referenceId: grant.referenceId,
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        },
      },
      select: {
        id: true,
      },
    });

    if (existingBucket) {
      continue;
    }

    const amount = convertCreditsToCents(grant.credits);
    await tx.transaction.create({
      data: {
        amount,
        ...(organizationId
          ? {
              organization: {
                connect: {
                  id: organizationId,
                },
              },
            }
          : {}),
        sourceCreditBucket: {
          create: {
            amount,
            expiresAt: params.periodEnd,
            organizationId,
            referenceId: grant.referenceId,
            referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
            userId: grant.userId,
          },
        },
        user: {
          connect: {
            id: grant.userId,
          },
        },
      },
    });

    grantsCreated += 1;
  }

  return {
    grantsCreated,
    subscriptionCreated,
    subscriptionId,
  };
}

export async function ensureInitialLocalFreeSubscriptionPeriod(
  params: EnsureInitialLocalFreeSubscriptionPeriodParams,
  tx: Prisma.TransactionClient,
): Promise<EnsureLocalFreeSubscriptionPeriodResult> {
  const periodStart = resolveSubscriptionPeriodStart(params.createdAt);
  const periodEnd = getNextMonthlyPeriodEnd(periodStart);

  if (params.kind === "user") {
    return await ensureLocalFreeSubscriptionPeriod(
      {
        organizationId: null,
        userId: params.userId,
        periodEnd,
        periodStart,
        referenceId: params.userId,
        stripeCustomerId: params.stripeCustomerId,
      },
      tx,
    );
  }

  const members = await tx.member.findMany({
    where: {
      organizationId: params.organizationId,
    },
  });
  const memberUserIds = members.map((member) => member.userId);

  return await ensureLocalFreeSubscriptionPeriod(
    {
      memberUserIds,
      organizationId: params.organizationId,
      periodEnd,
      periodStart,
      referenceId: params.organizationId,
      stripeCustomerId: params.stripeCustomerId,
    },
    tx,
  );
}
