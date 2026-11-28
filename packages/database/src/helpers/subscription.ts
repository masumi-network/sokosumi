import {
  convertCreditsToCents,
  FREE_SUBSCRIPTION_MONTHLY_CREDITS,
} from "@sokosumi/utils";
import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import type { TableNetwork } from "../sql-tables.js";
import {
  ORGANIZATION_CREDIT_REFERENCE_PREFIX,
  USER_CREDIT_REFERENCE_PREFIX,
} from "./credit.js";
import {
  findCreditBucketByReference,
  insertCreditGrant,
} from "./credit-grant-sql.js";
import { resolvePurchasedSeats } from "./organization-seats.js";

export const ACTIVE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
] as const;

export const FREE_SUBSCRIPTION_PLAN = "free";
const MONTHLY_BILLING_INTERVAL = "month";

/** Pre-create next local-free period this far before current periodEnd (5m cron × 3+ ticks). */
export const FREE_SUBSCRIPTION_PRECREATE_LOOKAHEAD_MS = 15 * 60 * 1000;

const LOCAL_FREE_SUBSCRIPTION_REFERENCE_SEGMENT = "local-free:";

export const LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS = ":local-free:";

/**
 * A local free period's credits: a person's, or an Organization's pool with
 * no member. Once per owner and period, by a reference of the owner and
 * `periodEnd`; they expire at the period's end.
 */
export interface LocalFreePeriodCredits {
  owner:
    | { userId: string; organizationId?: never }
    | { organizationId: string; userId?: never };
  credits: number;
  periodEnd: Date;
  /** Null is active now. */
  activatesAt: Date | null;
}

/**
 * Gives a period's credits on the caller's transaction: Core's credits
 * module (`grant`), which writes them with `grantLocalFreePeriodCredits`.
 */
export type GrantLocalFreePeriodCredits = (
  credits: LocalFreePeriodCredits,
) => Promise<{ outcome: "granted" | "already_granted" }>;

interface EnsureLocalFreeSubscriptionPeriodBaseParams {
  activatesAt?: Date | null;
  billingAnchorDate: Date;
  periodEnd: Date;
  periodStart: Date;
  referenceId: string;
  stripeCustomerId?: null | string;
  grantCredits: GrantLocalFreePeriodCredits;
}

export interface EnsureLocalFreeUserSubscriptionPeriodParams
  extends EnsureLocalFreeSubscriptionPeriodBaseParams {
  organizationId: null;
  userId: string;
}

export interface EnsureLocalFreeOrganizationSubscriptionPeriodParams
  extends EnsureLocalFreeSubscriptionPeriodBaseParams {
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

export interface TransitionToNextLocalFreeSubscriptionPeriodParams
  extends TransitionToNextLocalFreeSubscriptionParams {
  grantCredits: GrantLocalFreePeriodCredits;
}

interface EnsureInitialLocalFreeSubscriptionPeriodBaseParams {
  createdAt: Date;
  grantCredits: GrantLocalFreePeriodCredits;
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

export function buildLocalFreeOrganizationSubscriptionReferenceId(
  organizationId: string,
  periodEnd: Date,
): string {
  return `${ORGANIZATION_CREDIT_REFERENCE_PREFIX}${organizationId}:${LOCAL_FREE_SUBSCRIPTION_REFERENCE_SEGMENT}${periodEnd.toISOString()}:subscription`;
}

function normalizeLocalFreeSubscriptionPeriod(
  params: EnsureLocalFreeSubscriptionPeriodParams,
): {
  owner: LocalFreePeriodCredits["owner"];
  seats: null | number;
} {
  if (!isOrganizationSubscriptionPeriodParams(params)) {
    return { owner: { userId: params.userId }, seats: 1 };
  }

  return {
    owner: { organizationId: params.organizationId },
    seats: resolvePurchasedSeats(params.purchasedSeats),
  };
}

function buildNextLocalFreePeriod(subscription: {
  createdAt: Date;
  endedAt: Date | null;
  periodEnd: Date;
}): NextLocalFreePeriod {
  // A subscription canceled immediately keeps its old periodEnd. Cover the
  // rest of that period with a short free period so the user is on Free now,
  // and later renewals keep the old boundary.
  if (subscription.endedAt && subscription.endedAt < subscription.periodEnd) {
    return {
      periodEnd: new Date(subscription.periodEnd.getTime()),
      periodStart: new Date(subscription.endedAt.getTime()),
    };
  }

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
  grantCredits: GrantLocalFreePeriodCredits;
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
    endedAt: subscription.endedAt,
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
    await ensureLocalFreeSubscriptionPeriod(
      {
        activatesAt,
        billingAnchorDate: subscription.createdAt,
        grantCredits: params.grantCredits,
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
      grantCredits: params.grantCredits,
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
  params: TransitionToNextLocalFreeSubscriptionPeriodParams,
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
    endedAt: subscription.endedAt,
    periodEnd: subscription.periodEnd,
  });

  const ensured = await ensureNextLocalFreeSubscriptionPeriod(
    {
      activatesAt: periodStart <= settledAt ? null : periodStart,
      grantCredits: params.grantCredits,
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
  const { owner, seats } = normalizeLocalFreeSubscriptionPeriod(params);
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

  const { outcome } = await params.grantCredits({
    owner,
    credits: FREE_SUBSCRIPTION_MONTHLY_CREDITS,
    periodEnd: params.periodEnd,
    activatesAt: params.activatesAt ?? null,
  });

  return {
    grantsCreated: outcome === "granted" ? 1 : 0,
    subscriptionCreated,
    subscriptionId,
  };
}

/**
 * Writes a local free period's credits unless they were given: the positive
 * transaction and its bucket, both of the owner's (an Organization's with no
 * member). Only Core's credits module calls it; `created` is false when a
 * bucket of the period's reference is there, and nothing is written then.
 */
export async function grantLocalFreePeriodCredits(
  input: LocalFreePeriodCredits,
  tx: Prisma.TransactionClient,
  options?: { mintId?: () => string; network?: TableNetwork },
): Promise<{ created: boolean }> {
  const network = options?.network ?? "mainnet";
  const organizationId = input.owner.organizationId ?? null;
  const userId = input.owner.userId ?? null;
  const referenceId =
    input.owner.userId === undefined
      ? buildLocalFreeOrganizationSubscriptionReferenceId(
          input.owner.organizationId,
          input.periodEnd,
        )
      : buildLocalFreeUserSubscriptionReferenceId(
          input.owner.userId,
          input.periodEnd,
        );
  const existingBucket = await findCreditBucketByReference(
    {
      network,
      referenceId,
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
    },
    tx,
  );

  if (existingBucket) {
    return { created: false };
  }

  const amount = convertCreditsToCents(input.credits);
  await insertCreditGrant(
    {
      mintId: options?.mintId,
      network,
      activatesAt: input.activatesAt,
      amount,
      expiresAt: input.periodEnd,
      organizationId,
      referenceId,
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      userId,
    },
    tx,
  );

  return { created: true };
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
        grantCredits: params.grantCredits,
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

  return await ensureLocalFreeSubscriptionPeriod(
    {
      billingAnchorDate: params.createdAt,
      grantCredits: params.grantCredits,
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
