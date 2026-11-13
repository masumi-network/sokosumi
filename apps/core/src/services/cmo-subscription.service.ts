import * as Sentry from "@sentry/node";
import { CreditBucketReferenceType } from "@sokosumi/database";
import { getNextMonthlyPeriodEnd } from "@sokosumi/database/helpers";
import { convertCreditsToCents } from "@sokosumi/utils";
import { z } from "zod";

import type { PolarWebhookEvent } from "@/clients/polar.client";
import { writeOffCreditBucketsById } from "@/helpers/cuso-project-credits";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { cmoProductMetadataSchema } from "@/services/cmo-catalog.service";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

/** What Polar's events do to a Cuso's CMO subscription and its credits (ADR 0068). */

type OrderPaidEvent = Extract<PolarWebhookEvent, { type: "order.paid" }>;
type OrderRefundedEvent = Extract<
  PolarWebhookEvent,
  { type: "order.refunded" }
>;
type SubscriptionEvent = Extract<
  PolarWebhookEvent,
  {
    type:
      | "subscription.created"
      | "subscription.active"
      | "subscription.updated";
  }
>;
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
 * Writes the subscription's state from a Polar payload and returns its row,
 * or the reason no row can exist. Polar does not order its deliveries, so a
 * payload older than the stored state changes nothing.
 */
async function upsertCmoSubscription(
  source: SubscriptionSource,
): Promise<{ id: string; projectId: string; organizationId: string } | string> {
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
      : ENDED_STATUSES.has(subscription.status)
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
  if (stored) return stored;

  const metadata = cmoCheckoutMetadataSchema.safeParse(source.metadata);
  if (!metadata.success) return "no CMO checkout metadata";
  const { organizationId, projectId } = metadata.data;
  if (
    source.externalCustomerId &&
    source.externalCustomerId !== organizationId
  ) {
    return "the Polar customer is not the organization of the checkout";
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace: { organizationId } },
    select: { id: true },
  });
  if (!project) return "unknown organization or Project";

  try {
    return await prisma.cmoSubscription.create({
      data: { ...state, ...where, organizationId, projectId },
      select: ROW_SELECT,
    });
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) throw error;
    // Either another delivery created this subscription's row first, or the
    // Project already has a subscription that has not ended.
    return (
      (await applyToStoredRow()) ??
      "the Project already has a CMO subscription that has not ended"
    );
  }
}

/** `subscription.*`: only the row changes; credits come with `order.paid`. */
export async function handlePolarSubscriptionEvent(
  event: SubscriptionEvent,
): Promise<void> {
  const subscription = event.data;
  const extra = {
    polarSubscriptionId: subscription.id,
    polarProductId: subscription.product_id,
    metadata: subscription.metadata,
  };
  const plan = planOfProduct(
    subscription.product.metadata,
    subscription.recurring_interval,
  );
  if (!plan) {
    reportUnusableEvent(event, "the product is not a CMO plan", extra);
    return;
  }
  const row = await upsertCmoSubscription({
    eventAt: new Date(event.timestamp),
    externalCustomerId: subscription.customer.external_id,
    metadata: subscription.metadata,
    pendingProductId: subscription.pending_update?.product_id ?? null,
    plan,
    subscription,
  });
  if (typeof row === "string") reportUnusableEvent(event, row, extra);
}

/**
 * `order.paid`: the only event that grants. The first order of a plan records
 * the subscription and grants its first month as Project credits. The grant
 * rides on the bucket's unique key, so a redelivered or raced event ends there.
 */
export async function handlePolarOrderPaid(
  event: OrderPaidEvent,
): Promise<void> {
  const order = event.data;
  if (order.billing_reason !== "subscription_create") return;
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
  const row = await upsertCmoSubscription({
    eventAt: paidAt,
    externalCustomerId: order.customer.external_id,
    metadata: order.metadata,
    plan,
    subscription,
  });
  if (typeof row === "string") {
    reportUnusableEvent(event, row, extra);
    return;
  }

  const { organizationId, projectId } = row;
  const amount = convertCreditsToCents(plan.credits);
  const monthStart = new Date(subscription.current_period_start);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          amount,
          organizationId,
          userId: null,
          sourceCreditBucket: {
            create: {
              amount,
              // One month after the grant month starts; a monthly plan's
              // month is the period Polar billed.
              expiresAt:
                plan.interval === "month"
                  ? new Date(subscription.current_period_end)
                  : getNextMonthlyPeriodEnd(monthStart, monthStart),
              organizationId,
              projectId,
              referenceId: `${order.id}:0`,
              referenceNote: product.name,
              referenceType: CreditBucketReferenceType.CMO_SUBSCRIPTION_MONTH,
              userId: null,
            },
          },
        },
      });
      await tx.cmoSubscription.updateMany({
        where: {
          id: row.id,
          OR: [{ lastPaidAt: null }, { lastPaidAt: { lt: paidAt } }],
        },
        data: { lastPaidOrderId: order.id, lastPaidAt: paidAt },
      });
      await markOutOfCreditsTasksAsToppedUp({
        organizationId,
        projectId,
        tx,
        userId: null,
      });
    });
  } catch (error) {
    // The bucket of this order and month exists: granted by an earlier or a
    // concurrent delivery.
    if (!isPrismaUniqueViolation(error)) throw error;
  }
}

/**
 * `order.refunded`: writes off what is left of every bucket the order granted
 * (a yearly order grants one per month), so the refund and the balance agree.
 * Credits already spent stay spent. Polar sends it for a partial refund too;
 * the rest goes all the same.
 */
export async function handlePolarOrderRefunded(
  event: OrderRefundedEvent,
): Promise<void> {
  const order = event.data;
  // Serializable: of two deliveries at the same time one fails, then runs
  // again and finds nothing left.
  const granted = await serializableTransaction(async (tx) => {
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
    return buckets.length > 0;
  }, "The refund raced another write to the same credits");
  if (!granted) {
    reportUnusableEvent(event, "the refunded order granted no credits", {
      polarOrderId: order.id,
      polarSubscriptionId: order.subscription_id,
      metadata: order.metadata,
    });
  }
}
