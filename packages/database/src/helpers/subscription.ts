import {
  convertCreditsToCents,
  FREE_SUBSCRIPTION_MONTHLY_CREDITS,
} from "@sokosumi/utils";
import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import {
  buildOrganizationMemberSubscriptionReferenceId,
  ORGANIZATION_CREDIT_REFERENCE_PREFIX,
  USER_CREDIT_REFERENCE_PREFIX,
} from "./credit.js";
import {
  getSortedUniqueUserIds,
  resolvePurchasedSeats,
} from "./organization-seats.js";
import { fetchOrganizationMemberUserIds } from "./organization-subscription-credit-audience.js";

export const ACTIVE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
] as const;

export const FREE_SUBSCRIPTION_PLAN = "free";
export const MONTHLY_BILLING_INTERVAL = "month";

/** Pre-create next local-free period this far before current periodEnd (5m cron × 3+ ticks). */
export const FREE_SUBSCRIPTION_PRECREATE_LOOKAHEAD_MS = 15 * 60 * 1000;

/**
 * Reference suffix segment that marks a member subscription-period credit
 * bucket as a free-tier grant (as opposed to a paid seat or invoice grant).
 *
 * Free-tier buckets share the `member:{userId}:` prefix with paid grants so
 * they are read as the member's subscription credits, but seat-accounting
 * helpers must exclude them so they do not consume paid seat capacity.
 */
export const LOCAL_FREE_SUBSCRIPTION_REFERENCE_SEGMENT = "local-free:";

/**
 * Substring used to detect free-tier member subscription-period buckets in
 * `referenceId` filters. Full reference ids look like
 * `member:{userId}:local-free:{organizationId}:{periodEnd}`.
 */
export const LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS = ":local-free:";

interface LocalFreeSubscriptionGrant {
  bucketUserId: string | null;
  credits: number;
  referenceId: string;
  userId: string;
}

interface EnsureLocalFreeSubscriptionPeriodBaseParams {
  activatesAt?: Date | null;
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
  purchasedSeats?: number;
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
    seats: number | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  };
}

interface EnsureInitialLocalFreeSubscriptionPeriodBaseParams {
  createdAt: Date;
  /**
   * Null when seeding happens before the Stripe customer exists (synchronous
   * seeding at organization creation). The customer.created webhook re-runs
   * the same idempotent ensure once the customer id is known.
   */
  stripeCustomerId: string | null;
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
    `${LOCAL_FREE_SUBSCRIPTION_REFERENCE_SEGMENT}${organizationId}:${periodEnd.toISOString()}`,
  );
}

export function buildLocalFreeOrganizationSubscriptionReferenceId(
  organizationId: string,
  periodEnd: Date,
): string {
  return `${ORGANIZATION_CREDIT_REFERENCE_PREFIX}${organizationId}:${LOCAL_FREE_SUBSCRIPTION_REFERENCE_SEGMENT}${periodEnd.toISOString()}:subscription`;
}

export interface GrantFreeOrganizationMemberSubscriptionCreditsParams {
  memberUserIds: string[];
  now?: Date;
  organizationId: string;
  periodEnd: Date;
}

/**
 * Grants free monthly subscription credits to organization members for the
 * current subscription period without creating a separate local-free
 * `Subscription` row. This lets unassigned members of a paid (Stripe-backed)
 * organization receive the free tier alongside assigned members' paid credits.
 *
 * Grants are idempotent per period: a member that already holds a free-tier
 * bucket that has not expired yet is skipped. This mirrors the drift-tolerant
 * matching used for paid seat grants, so invoice-driven and event-driven grants
 * for the same period do not double up.
 */
export async function grantFreeOrganizationMemberSubscriptionCredits(
  params: GrantFreeOrganizationMemberSubscriptionCreditsParams,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const now = params.now ?? new Date();
  if (params.periodEnd <= now) {
    return 0;
  }

  const userIds = getSortedUniqueUserIds(params.memberUserIds);
  if (userIds.length === 0) {
    return 0;
  }

  const amount = convertCreditsToCents(FREE_SUBSCRIPTION_MONTHLY_CREDITS);
  let grantsCreated = 0;

  for (const userId of userIds) {
    const referenceId = buildLocalFreeOrganizationMemberSubscriptionReferenceId(
      userId,
      params.organizationId,
      params.periodEnd,
    );

    // Idempotency: any bucket for this period (including future `activatesAt` from
    // pre-create). Spendability is enforced separately via creditBucketActivatesAtOrBefore.
    const existingForPeriod = await tx.creditBucket.findUnique({
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

    if (existingForPeriod) {
      continue;
    }

    await tx.transaction.create({
      data: {
        amount,
        organization: {
          connect: {
            id: params.organizationId,
          },
        },
        sourceCreditBucket: {
          create: {
            amount,
            expiresAt: params.periodEnd,
            organizationId: params.organizationId,
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

    grantsCreated += 1;
  }

  return grantsCreated;
}

function getOrganizationMemberUserIds(
  params: EnsureLocalFreeOrganizationSubscriptionPeriodParams,
): string[] {
  return getSortedUniqueUserIds(params.memberUserIds);
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
          bucketUserId: params.userId,
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
  const transactionUserId = memberUserIds[0];

  return {
    grants:
      transactionUserId === undefined
        ? []
        : [
            {
              bucketUserId: null,
              credits: FREE_SUBSCRIPTION_MONTHLY_CREDITS,
              referenceId: buildLocalFreeOrganizationSubscriptionReferenceId(
                params.organizationId,
                params.periodEnd,
              ),
              userId: transactionUserId,
            },
          ],
    organizationId: params.organizationId,
    seats: resolvePurchasedSeats(params.purchasedSeats),
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
  endedAtFallback: Date;
  id: string;
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
      endedAt: params.subscription.endedAt ?? params.endedAtFallback,
      status: "canceled",
    },
  });
}

export interface EnsureNextLocalFreeSubscriptionPeriodParams {
  activatesAt?: Date | null;
  subscription: TransitionToNextLocalFreeSubscriptionParams["subscription"];
}

export async function ensureNextLocalFreeSubscriptionPeriod(
  params: EnsureNextLocalFreeSubscriptionPeriodParams,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const { subscription } = params;

  if (!subscription.periodEnd) {
    return false;
  }

  const { periodEnd, periodStart } = buildNextLocalFreePeriod({
    createdAt: subscription.createdAt,
    periodEnd: subscription.periodEnd,
  });
  const activatesAt =
    params.activatesAt === undefined ? periodStart : params.activatesAt;

  const organization = await tx.organization.findUnique({
    where: {
      id: subscription.referenceId,
    },
    select: {
      id: true,
    },
  });

  if (organization) {
    const memberUserIds = await fetchOrganizationMemberUserIds(
      organization.id,
      tx,
    );

    await ensureLocalFreeSubscriptionPeriod(
      {
        activatesAt,
        billingAnchorDate: subscription.createdAt,
        memberUserIds,
        organizationId: organization.id,
        periodEnd,
        periodStart,
        purchasedSeats: subscription.seats ?? undefined,
        referenceId: organization.id,
        stripeCustomerId: subscription.stripeCustomerId,
      },
      tx,
    );
    return true;
  }

  const user = await tx.user.findUnique({
    where: {
      id: subscription.referenceId,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    return false;
  }

  await ensureLocalFreeSubscriptionPeriod(
    {
      activatesAt,
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
  return true;
}

export async function closeOverdueLocalFreeSubscription(
  params: TransitionToNextLocalFreeSubscriptionParams,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const { subscription } = params;
  const settledAt = new Date();
  const endedAtFallback = subscription.periodEnd ?? settledAt;

  await closeOutSourceSubscription({
    endedAtFallback,
    id: subscription.id,
    setCanceledAt: params.setCanceledAt,
    settledAt,
    subscription,
    tx,
  });
}

export async function transitionToNextLocalFreeSubscriptionPeriod(
  params: TransitionToNextLocalFreeSubscriptionParams,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const { subscription } = params;
  const settledAt = new Date();

  if (!subscription.periodEnd) {
    await closeOverdueLocalFreeSubscription(params, tx);
    return;
  }

  const { periodStart } = buildNextLocalFreePeriod({
    createdAt: subscription.createdAt,
    periodEnd: subscription.periodEnd,
  });

  const ensured = await ensureNextLocalFreeSubscriptionPeriod(
    {
      activatesAt: periodStart <= settledAt ? null : periodStart,
      subscription,
    },
    tx,
  );

  if (!ensured) {
    await closeOutSourceSubscription({
      endedAtFallback: periodStart,
      id: subscription.id,
      setCanceledAt: true,
      settledAt,
      subscription,
      tx,
    });
    return;
  }

  await closeOverdueLocalFreeSubscription(params, tx);
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
            activatesAt: params.activatesAt ?? null,
            amount,
            expiresAt: params.periodEnd,
            organizationId,
            referenceId: grant.referenceId,
            referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
            userId: grant.bucketUserId,
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

  const memberUserIds = await fetchOrganizationMemberUserIds(
    params.organizationId,
    tx,
  );

  return await ensureLocalFreeSubscriptionPeriod(
    {
      billingAnchorDate: params.createdAt,
      memberUserIds,
      organizationId: params.organizationId,
      periodEnd,
      periodStart,
      purchasedSeats: 1,
      referenceId: params.organizationId,
      stripeCustomerId: params.stripeCustomerId,
    },
    tx,
  );
}
