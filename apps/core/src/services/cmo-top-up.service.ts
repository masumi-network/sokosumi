import { CreditBucketReferenceType } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS, convertCreditsToCents } from "@sokosumi/utils";

import type { PolarWebhookEvent } from "@/clients/polar.client";
import { serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  cmoProductMetadataSchema,
  getCmoCatalog,
} from "@/services/cmo-catalog.service";
import { startCmoCheckout } from "@/services/cmo-checkout.service";
import { grantCmoCredits } from "@/services/cmo-credit-grant.service";
import { CmoConflictError, type CusoTarget } from "@/services/cmo-cuso.service";
import {
  reportUnusableEvent,
  resolveCheckoutTarget,
} from "@/services/cmo-subscription.service";

/** Project top-ups: credits a member buys for one subscribed Cuso (ADR 0068). */

/**
 * Starts Polar's checkout with every top-up pack for the Cuso a member named
 * and returns its URL. Any member may buy; a Cuso without an active CMO
 * subscription is paused, so credits for him are not sold.
 */
export async function startCmoTopUpCheckout(
  input: CusoTarget & { returnUrl: string },
): Promise<{ url: string }> {
  return await startCmoCheckout(input, "top-up", async (cuso) => {
    const subscription = await prisma.cmoSubscription.findFirst({
      where: { projectId: cuso.projectId, status: "active", endedAt: null },
      select: { id: true },
    });
    if (!subscription) {
      throw new CmoConflictError(
        "A top-up needs an active CMO subscription",
        CORE_API_ERROR_KINDS.SUBSCRIPTION_NOT_ACTIVE,
      );
    }
    const { topUps } = await getCmoCatalog();
    if (topUps.length === 0) {
      throw serviceUnavailable("Project top-ups are not set up");
    }
    return topUps.map((pack) => pack.productId);
  });
}

/**
 * `order.paid` for a one-time purchase: grants the pack as Project credits
 * that last 12 months. The Project and organization come from the checkout's
 * metadata; the grant rides on the bucket's unique key, so a redelivered or
 * raced event ends there. The plan's month expires sooner, so it is spent
 * first (soonest expiry first, ADR 0067).
 */
export async function handlePolarTopUpPaid(
  event: Extract<PolarWebhookEvent, { type: "order.paid" }>,
): Promise<void> {
  const order = event.data;
  const extra = {
    polarOrderId: order.id,
    polarProductId: order.product?.id,
    metadata: order.metadata,
  };
  const pack = cmoProductMetadataSchema.safeParse(order.product?.metadata);
  if (!order.product || !pack.success || pack.data.kind !== "top-up") {
    reportUnusableEvent(event, "the product is not a top-up pack", extra);
    return;
  }
  const target = await resolveCheckoutTarget(
    order.metadata,
    order.customer.external_id,
  );
  if (target.isErr()) {
    reportUnusableEvent(event, target.error.issue, extra);
    return;
  }
  const { organizationId, projectId } = target.value;

  const amount = convertCreditsToCents(pack.data.credits);
  // An order has no paid date of its own: the event's timestamp stands in.
  const expiresAt = new Date(event.timestamp);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  const granted = await grantCmoCredits({
    amount,
    expiresAt,
    organizationId,
    projectId,
    referenceId: `${order.id}:0`,
    referenceNote: order.product.name,
    referenceType: CreditBucketReferenceType.PROJECT_TOP_UP,
    subscription: { projectId },
  });
  if (granted === "not_live") {
    reportUnusableEvent(
      event,
      "the Cuso has no live subscription; refund by hand",
      extra,
    );
  }
}
