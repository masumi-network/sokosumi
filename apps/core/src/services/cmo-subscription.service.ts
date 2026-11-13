import * as Sentry from "@sentry/node";
import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { getNextMonthlyPeriodEnd } from "@sokosumi/database/helpers";
import { convertCreditsToCents } from "@sokosumi/utils";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import {
  type PolarWebhookEvent,
  revokePolarSubscription,
} from "@/clients/polar.client";
import { writeOffCreditBucketsById } from "@/helpers/cuso-project-credits";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { cmoProductMetadataSchema } from "@/services/cmo-catalog.service";
import { grantCmoCredits } from "@/services/cmo-credit-grant.service";
import { LIVE_CUSO_WHERE } from "@/services/cmo-cuso.service";
import { monthOfPaidYear } from "@/services/cmo-yearly-grant-sync.service";

/** What Polar's events do to a Cuso's CMO subscription and its credits (ADR 0068). */

type OrderPaidEvent = Extract<PolarWebhookEvent, { type: "order.paid" }>;
type OrderRefundedEvent = Extract<
  PolarWebhookEvent,
  { type: "order.refunded" }
>;
/** The subscription events that write a Cuso's CMO subscription. */
const SUBSCRIPTION_EVENT_TYPES = [
  "subscription.created",
  "subscription.active",
  "subscription.updated",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.past_due",
  "subscription.revoked",
] as const satisfies PolarWebhookEvent["type"][];
type SubscriptionEvent = Extract<
  PolarWebhookEvent,
  { type: (typeof SUBSCRIPTION_EVENT_TYPES)[number] }
>;

export function isCmoSubscriptionEvent(
  event: PolarWebhookEvent,
): event is SubscriptionEvent {
  return (SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(event.type);
}
type PolarSubscription = SubscriptionEvent["data"];
/** The subscription state an order carries too. */
type SubscriptionState = Pick<
  PolarSubscription,
  | "id"
  | "status"
  | "product_id"
  | "recurring_interval"
  | "current_period_start"
  | "current_period_end"
  | "cancel_at_period_end"
  | "ended_at"
>;

/**
 * The metadata every CMO checkout carries; Polar copies it to the order and
 * the subscription. `userId` is the member who paid.
 */
export const cmoCheckoutMetadataSchema = z.object({
  projectId: z.uuid(),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});
export type CmoCheckoutMetadata = z.infer<typeof cmoCheckoutMetadataSchema>;

/** Polar statuses after which a subscription never bills again. */
const ENDED_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

const ROW_SELECT = { id: true, projectId: true, organizationId: true } as const;
type CmoSubscriptionRow = {
  id: string;
  projectId: string;
  organizationId: string;
};

/** Why an event can make no row: reported with what else it knows. */
interface UnusableEvent {
  issue: string;
  extra?: Record<string, unknown>;
}

interface CmoPlanOfProduct {
  credits: number;
  interval: "month" | "year";
  tier: string;
}

interface SubscriptionSource {
  eventAt: Date;
  externalCustomerId: string | null | undefined;
  metadata: Record<string, unknown>;
  /** Left out by an order, which does not carry the pending change. */
  pendingProductId?: string | null;
  plan: CmoPlanOfProduct;
  /** `subscription.revoked`: ended, whatever status the payload carries. */
  revoked?: boolean;
  subscription: SubscriptionState;
}

/**
 * An event that can never succeed (Polar would retry it until it disables the
 * endpoint): reported, then acknowledged by the caller.
 */
export function reportUnusableEvent(
  event: PolarWebhookEvent,
  issue: string,
  extra: Record<string, unknown>,
): void {
  Sentry.captureMessage(`Polar event ignored: ${issue}`, {
    level: "error",
    tags: { error_type: "polar_event_ignored", polar_event_type: event.type },
    extra,
  });
}

function planOfProduct(
  metadata: Record<string, unknown>,
  interval: string | null,
): CmoPlanOfProduct | null {
  const parsed = cmoProductMetadataSchema.safeParse(metadata);
  if (!parsed.success || parsed.data.kind !== "plan") return null;
  if (interval !== "month" && interval !== "year") return null;
  return { credits: parsed.data.credits, interval, tier: parsed.data.tier };
}

/**
 * The organization and Project a checkout's metadata names, once the Polar
 * customer is that organization (by its external id) and the Project is in
 * it. Renewals carry no metadata: they go by the stored subscription.
 */
export async function resolveCheckoutTarget(
  checkoutMetadata: Record<string, unknown>,
  externalCustomerId: string | null | undefined,
): Promise<
  Result<{ organizationId: string; projectId: string }, UnusableEvent>
> {
  const metadata = cmoCheckoutMetadataSchema.safeParse(checkoutMetadata);
  if (!metadata.success) return err({ issue: "no CMO checkout metadata" });
  const { organizationId, projectId } = metadata.data;
  if (externalCustomerId !== organizationId) {
    return err({
      issue: "the Polar customer is not the organization of the checkout",
    });
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace: { organizationId } },
    select: { id: true },
  });
  if (!project) return err({ issue: "unknown organization or Project" });
  return ok({ organizationId, projectId });
}

/**
 * Writes the subscription's state from a Polar payload and returns its row,
 * or the reason no row can exist (an error to report). Polar does not order
 * its deliveries, so a payload older than the stored state changes nothing.
 */
async function upsertCmoSubscription(
  source: SubscriptionSource,
): Promise<Result<CmoSubscriptionRow, UnusableEvent>> {
  const { eventAt, plan, subscription } = source;
  const where = { polarSubscriptionId: subscription.id };
  const state = {
    polarProductId: subscription.product_id,
    tier: plan.tier,
    interval: plan.interval,
    status: subscription.status,
    currentPeriodStart: new Date(subscription.current_period_start),
    currentPeriodEnd: new Date(subscription.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    endedAt: subscription.ended_at
      ? new Date(subscription.ended_at)
      : source.revoked || ENDED_STATUSES.has(subscription.status)
        ? eventAt
        : null,
    polarEventAt: eventAt,
    ...(source.pendingProductId !== undefined && {
      pendingPolarProductId: source.pendingProductId,
    }),
  };
  async function applyToStoredRow() {
    await prisma.cmoSubscription.updateMany({
      where: { ...where, polarEventAt: { lte: eventAt } },
      data: state,
    });
    return await prisma.cmoSubscription.findUnique({
      where,
      select: ROW_SELECT,
    });
  }

  const stored = await applyToStoredRow();
  if (stored) return ok(stored);

  const target = await resolveCheckoutTarget(
    source.metadata,
    source.externalCustomerId,
  );
  if (target.isErr()) return err(target.error);
  const { organizationId, projectId } = target.value;

  // A checkout paid, or first delivered, after its Cuso ended: the ending
  // found no row to revoke, so Polar would go on charging. Revoked here and
  // kept as ended, so later deliveries change nothing.
  const cuso = await prisma.sokoBot.findFirst({
    where: { ...LIVE_CUSO_WHERE, projectId },
    select: { id: true },
  });
  if (!cuso) {
    const revokedAt = new Date();
    if (!state.endedAt) await revokePolarSubscription(subscription.id);
    try {
      await prisma.cmoSubscription.create({
        data: {
          ...state,
          ...(!state.endedAt && {
            status: "canceled",
            endedAt: revokedAt,
            polarEventAt: revokedAt,
          }),
          ...where,
          organizationId,
          projectId,
        },
      });
    } catch (error) {
      // Another delivery of the same subscription recorded it first.
      if (!isPrismaUniqueViolation(error)) throw error;
    }
    return err({ issue: "the Cuso has ended; the subscription is revoked" });
  }

  try {
    return ok(
      await prisma.cmoSubscription.create({
        data: { ...state, ...where, organizationId, projectId },
        select: ROW_SELECT,
      }),
    );
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) throw error;
    // Either another delivery created this subscription's row first, or the
    // Project already has a subscription that has not ended.
    const raced = await applyToStoredRow();
    if (raced) return ok(raced);
    // A second paid subscription for the Project would be charged without
    // credits: Polar ends it now, and an operator refunds it.
    const live = await prisma.cmoSubscription.findFirst({
      where: { projectId, endedAt: null },
      select: { polarSubscriptionId: true },
    });
    await revokePolarSubscription(subscription.id);
    return err({
      issue: "a second CMO subscription for the Project, revoked at Polar",
      extra: { livePolarSubscriptionId: live?.polarSubscriptionId },
    });
  }
}

/**
 * `subscription.*`: only the row changes; credits come with `order.paid`. A
 * scheduled cancel stays active with its period end, past due waits for
 * Polar to collect, and a revoke ends the row, so the Project is free for a
 * new checkout.
 */
export async function handlePolarSubscriptionEvent(
  event: SubscriptionEvent,
): Promise<void> {
  const issue = await writeCmoSubscription(event.data, {
    eventAt: new Date(event.timestamp),
    revoked: event.type === "subscription.revoked",
  });
  if (issue) reportUnusableEvent(event, issue.issue, issue.extra ?? {});
}

/**
 * Polar's answer to a plan change Core asked for, written at once so the
 * overview shows it before Polar's `subscription.updated` arrives. Polar's
 * own modification time is the event time: that webhook's timestamp is not
 * older, so it still applies, and nothing newer goes backwards.
 */
export async function recordCmoSubscriptionChange(
  subscription: PolarSubscription,
): Promise<void> {
  const issue = await writeCmoSubscription(subscription, {
    eventAt: new Date(subscription.modified_at ?? subscription.created_at),
  });
  if (issue) {
    Sentry.captureMessage(`Polar plan change not recorded: ${issue.issue}`, {
      level: "error",
      extra: issue.extra,
    });
  }
}

/** The row from a Polar subscription, or why it can make none. */
async function writeCmoSubscription(
  subscription: PolarSubscription,
  options: { eventAt: Date; revoked?: boolean },
): Promise<UnusableEvent | null> {
  const extra = {
    polarSubscriptionId: subscription.id,
    polarProductId: subscription.product_id,
    metadata: subscription.metadata,
  };
  const plan = planOfProduct(
    subscription.product.metadata,
    subscription.recurring_interval,
  );
  if (!plan) return { issue: "the product is not a CMO plan", extra };
  const row = await upsertCmoSubscription({
    eventAt: options.eventAt,
    externalCustomerId: subscription.customer.external_id,
    metadata: subscription.metadata,
    pendingProductId: subscription.pending_update?.product_id ?? null,
    plan,
    revoked: options.revoked,
    subscription,
  });
  if (row.isErr()) {
    return { issue: row.error.issue, extra: { ...extra, ...row.error.extra } };
  }
  return null;
}

/**
 * `order.paid`: the only event that grants. The first order of a plan records
 * the subscription and grants its first month as Project credits; each paid
 * renewal grants the month again at the tier Polar billed. A renewal Polar
 * could not collect has no paid order, so it grants nothing until it has. The
 * grant rides on the bucket's unique key, so a redelivered or raced event ends
 * there.
 */
export async function handlePolarOrderPaid(
  event: OrderPaidEvent,
): Promise<void> {
  const order = event.data;
  // A yearly cycle order grants month 0 only (expiring one month after the
  // period starts); the yearly grant job counts months 1 to 11 from it.
  if (
    order.billing_reason !== "subscription_create" &&
    order.billing_reason !== "subscription_cycle"
  ) {
    return;
  }
  const extra = {
    polarOrderId: order.id,
    polarSubscriptionId: order.subscription?.id,
    polarProductId: order.product?.id,
    metadata: order.metadata,
  };
  const { product, subscription } = order;
  const plan =
    product && subscription
      ? planOfProduct(product.metadata, subscription.recurring_interval)
      : null;
  if (!product || !subscription || !plan) {
    reportUnusableEvent(event, "the product is not a CMO plan", extra);
    return;
  }
  // An order has no paid date of its own: the event's timestamp stands in.
  const paidAt = new Date(event.timestamp);
  const upserted = await upsertCmoSubscription({
    eventAt: paidAt,
    externalCustomerId: order.customer.external_id,
    metadata: order.metadata,
    plan,
    subscription,
  });
  if (upserted.isErr()) {
    reportUnusableEvent(event, upserted.error.issue, {
      ...extra,
      ...upserted.error.extra,
    });
    return;
  }
  const row = upserted.value;

  const amount = convertCreditsToCents(plan.credits);
  // The period this order billed: its own line, because a late delivery
  // finds the subscription already in a later period.
  const billed = order.items?.find(
    (item) => !item.proration && item.start_timestamp && item.end_timestamp,
  );
  const monthStart = new Date(
    billed?.start_timestamp ?? subscription.current_period_start,
  );
  const granted = await grantCmoCredits(
    {
      amount,
      // One month after the grant month starts; a monthly plan's month is
      // the period Polar billed.
      expiresAt:
        plan.interval === "month"
          ? new Date(billed?.end_timestamp ?? subscription.current_period_end)
          : getNextMonthlyPeriodEnd(monthStart, monthStart),
      organizationId: row.organizationId,
      projectId: row.projectId,
      referenceId: `${order.id}:0`,
      referenceNote: product.name,
      referenceType: CreditBucketReferenceType.CMO_SUBSCRIPTION_MONTH,
      subscription: { cmoSubscriptionId: row.id },
    },
    (tx) => recordLastPaidOrder(tx, null),
  );
  if (granted === "not_live") reportNotLive(event, extra);
  if (granted === "refunded") {
    // Polar refunded it before its payment arrived: still the last paid
    // order, marked refunded, so a yearly plan grants no month of it.
    const refunded = await prisma.cmoPolarOrder.findUnique({
      where: { polarOrderId: order.id },
      select: { refundedAt: true },
    });
    await recordLastPaidOrder(prisma, refunded?.refundedAt ?? paidAt);
  }

  async function recordLastPaidOrder(
    client: Prisma.TransactionClient,
    refundedAt: Date | null,
  ): Promise<void> {
    await client.cmoSubscription.updateMany({
      where: {
        id: row.id,
        OR: [{ lastPaidAt: null }, { lastPaidAt: { lt: paidAt } }],
      },
      data: {
        lastPaidOrderId: order.id,
        lastPaidAt: paidAt,
        lastPaidOrderRefundedAt: refundedAt,
      },
    });
  }
}

/** A payment for a subscription that ended or a Cuso no longer live. */
function reportNotLive(
  event: PolarWebhookEvent,
  extra: Record<string, unknown>,
): void {
  reportUnusableEvent(
    event,
    "the subscription has ended or the Cuso is no longer live; refund by hand",
    extra,
  );
}

/** The old plan's monthly credits, which the upgrade wrote on the subscription. */
const upgradeFromCreditsSchema = z.object({
  upgradeFromCredits: z.coerce.number().int().nonnegative(),
});

/**
 * `order.paid` for a `subscription_update`: an upgrade Polar invoiced at once
 * grants the new monthly amount minus the old, times the share of the grant
 * month left when Polar made the order, expiring with that month's grant. It never moves the
 * last paid order: the yearly grant job counts a year's months from it.
 */
export async function handlePolarPlanChangePaid(
  event: OrderPaidEvent,
): Promise<void> {
  const order = event.data;
  const extra = {
    polarOrderId: order.id,
    polarSubscriptionId: order.subscription?.id,
    polarProductId: order.product?.id,
    metadata: order.subscription?.metadata,
  };
  const { product, subscription } = order;
  const plan =
    product && subscription
      ? planOfProduct(product.metadata, subscription.recurring_interval)
      : null;
  if (!product || !subscription || !plan) {
    reportUnusableEvent(event, "the product is not a CMO plan", extra);
    return;
  }
  const from = upgradeFromCreditsSchema.safeParse(subscription.metadata);
  if (!from.success) {
    reportUnusableEvent(event, "the upgrade has no old plan credits", extra);
    return;
  }
  const paidAt = new Date(event.timestamp);
  const upserted = await upsertCmoSubscription({
    eventAt: paidAt,
    externalCustomerId: order.customer.external_id,
    metadata: order.metadata,
    plan,
    subscription,
  });
  if (upserted.isErr()) {
    reportUnusableEvent(event, upserted.error.issue, {
      ...extra,
      ...upserted.error.extra,
    });
    return;
  }
  const row = upserted.value;
  // Polar prorates from when it made the order; a delivery comes later.
  const orderedAt = new Date(order.created_at);
  const periodStart = new Date(subscription.current_period_start);
  const month =
    plan.interval === "month"
      ? {
          startsAt: periodStart,
          expiresAt: new Date(subscription.current_period_end),
        }
      : monthOfPaidYear(periodStart, orderedAt);
  const left =
    (month.expiresAt.getTime() - orderedAt.getTime()) /
    (month.expiresAt.getTime() - month.startsAt.getTime());
  const credits = Math.round(
    (plan.credits - from.data.upgradeFromCredits) *
      Math.min(Math.max(left, 0), 1),
  );
  if (credits <= 0) return;
  const granted = await grantCmoCredits({
    amount: convertCreditsToCents(credits),
    expiresAt: month.expiresAt,
    organizationId: row.organizationId,
    projectId: row.projectId,
    referenceId: `${order.id}:0`,
    referenceNote: product.name,
    referenceType: CreditBucketReferenceType.CMO_SUBSCRIPTION_MONTH,
    subscription: { cmoSubscriptionId: row.id },
  });
  if (granted === "not_live") reportNotLive(event, extra);
}

/**
 * `order.refunded`: writes off what is left of every bucket the order granted
 * (a yearly order grants one per month), so the refund and the balance agree.
 * Credits already spent stay spent. Polar sends it for a partial refund too;
 * the rest goes all the same. A refunded last paid order is marked on its
 * subscription, so a yearly plan grants no more months of it. The refund is
 * recorded by order first, so a payment Polar delivers after it grants
 * nothing.
 */
export async function handlePolarOrderRefunded(
  event: OrderRefundedEvent,
): Promise<void> {
  const order = event.data;
  // Serializable: of two deliveries at the same time one fails, then runs
  // again and finds nothing left.
  await serializableTransaction(async (tx) => {
    // The row every grant of this order writes first (`grantCmoCredits`).
    await tx.$executeRaw`
      INSERT INTO "cmo_polar_order" ("polarOrderId", "refundedAt")
      VALUES (${order.id}, ${new Date(event.timestamp)})
      ON CONFLICT ("polarOrderId") DO UPDATE
      SET "refundedAt" = COALESCE("cmo_polar_order"."refundedAt", EXCLUDED."refundedAt")`;
    const buckets = await tx.creditBucket.findMany({
      where: {
        referenceId: { startsWith: `${order.id}:` },
        referenceType: {
          in: [
            CreditBucketReferenceType.CMO_SUBSCRIPTION_MONTH,
            CreditBucketReferenceType.PROJECT_TOP_UP,
          ],
        },
      },
      select: { id: true },
    });
    await writeOffCreditBucketsById(
      buckets.map((bucket) => bucket.id),
      tx,
    );
    // A refund does not cancel at Polar (an operator who refunds cancels
    // there if wanted), so the yearly grant job must stop granting the order.
    await tx.cmoSubscription.updateMany({
      where: { lastPaidOrderId: order.id, lastPaidOrderRefundedAt: null },
      data: { lastPaidOrderRefundedAt: new Date(event.timestamp) },
    });
  }, "The refund raced another write to the same credits");
}
