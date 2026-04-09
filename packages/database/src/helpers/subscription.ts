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
  billingAnchorDate: Date;
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

export interface TransitionToNextLocalFreeSubscriptionParams {
  setCanceledAt: boolean;
  subscription: {
    canceledAt: Date | null;
    createdAt: Date;
    endedAt: Date | null;
    id: string;
    periodEnd: Date | null;
    referenceId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  };
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

interface NextLocalFreePeriod {
  periodEnd: Date;
  periodStart: Date;
}

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

export function getNextMonthlyPeriodEnd(
  periodStart: Date,
  anchorDate: Date,
): Date {
  const year = periodStart.getUTCFullYear();
  const month = periodStart.getUTCMonth();
  const day = anchorDate.getUTCDate();
  const hours = periodStart.getUTCHours();
  const minutes = periodStart.getUTCMinutes();
  const seconds = periodStart.getUTCSeconds();
  const milliseconds = periodStart.getUTCMilliseconds();

  const targetMonthIndex = month + 1;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(day, lastDayOfTargetMonth),
      hours,
      minutes,
      seconds,
      milliseconds,
    ),
  );
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

function buildNextLocalFreePeriod(subscription: {
  createdAt: Date;
  periodEnd: Date;
}): NextLocalFreePeriod {
  const periodStart = new Date(subscription.periodEnd.getTime());
  return {
    periodEnd: getNextMonthlyPeriodEnd(periodStart, subscription.createdAt),
    periodStart,
  };
}

async function closeOutSourceSubscription(params: {
  id: string;
  periodStart: Date;
  setCanceledAt: boolean;
  settledAt: Date;
  subscription: TransitionToNextLocalFreeSubscriptionParams["subscription"];
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await params.tx.subscription.update({
    where: {
      id: params.id,
    },
    data: {
      ...(params.setCanceledAt
        ? { canceledAt: params.subscription.canceledAt ?? params.settledAt }
        : {}),
      endedAt: params.subscription.endedAt ?? params.periodStart,
      status: "canceled",
    },
  });
}

export async function transitionToNextLocalFreeSubscriptionPeriod(
  params: TransitionToNextLocalFreeSubscriptionParams,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const { subscription } = params;

  if (!subscription.periodEnd) {
    return;
  }

  const { periodEnd, periodStart } = buildNextLocalFreePeriod({
    createdAt: subscription.createdAt,
    periodEnd: subscription.periodEnd,
  });
  const settledAt = new Date();
  const organization = await tx.organization.findUnique({
    where: {
      id: subscription.referenceId,
    },
    select: {
      id: true,
    },
  });

  if (organization) {
    const members = await tx.member.findMany({
      where: {
        organizationId: organization.id,
      },
      select: {
        userId: true,
      },
    });

    if (members.length === 0) {
      throw new Error(
        `Cannot transition subscription ${subscription.id}: organization ${organization.id} has no members`,
      );
    }

    await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: subscription.createdAt,
        memberUserIds: members.map((member) => member.userId),
        organizationId: organization.id,
        periodEnd,
        periodStart,
        referenceId: organization.id,
        stripeCustomerId: subscription.stripeCustomerId,
      },
      tx,
    );
  } else {
    const user = await tx.user.findUnique({
      where: {
        id: subscription.referenceId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      await closeOutSourceSubscription({
        id: subscription.id,
        periodStart,
        setCanceledAt: true,
        settledAt,
        subscription,
        tx,
      });
      return;
    }

    await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: subscription.createdAt,
        organizationId: null,
        periodEnd,
        periodStart,
        referenceId: user.id,
        stripeCustomerId: subscription.stripeCustomerId,
        userId: user.id,
      },
      tx,
    );
  }

  await closeOutSourceSubscription({
    id: subscription.id,
    periodStart,
    setCanceledAt: params.setCanceledAt,
    settledAt,
    subscription,
    tx,
  });
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
        createdAt: params.billingAnchorDate,
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
  const periodEnd = getNextMonthlyPeriodEnd(periodStart, params.createdAt);

  if (params.kind === "user") {
    return await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: params.createdAt,
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
      billingAnchorDate: params.createdAt,
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
