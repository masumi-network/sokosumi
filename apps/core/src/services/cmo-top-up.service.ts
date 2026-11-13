import { CreditBucketReferenceType } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS, convertCreditsToCents } from "@sokosumi/utils";

import {
  createPolarCheckout,
  type PolarWebhookEvent,
} from "@/clients/polar.client";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import { serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  cmoProductMetadataSchema,
  getCmoCatalog,
} from "@/services/cmo-catalog.service";
import { grantCmoCredits } from "@/services/cmo-credit-grant.service";
import {
  CmoConflictError,
  type CusoTarget,
  cmoPayer,
  requireCuso,
} from "@/services/cmo-cuso.service";
import {
  type CmoCheckoutMetadata,
  cmoCheckoutMetadataSchema,
  reportUnusableEvent,
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
  if (!isFirstPartyAppUrl(input.returnUrl)) {
    throw new CmoConflictError("The return address must be CMO's own page");
  }
  const cuso = await requireCuso(input);
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
  const { organizationId } = await cmoPayer(cuso);
  const { topUps } = await getCmoCatalog();
  if (topUps.length === 0) {
    throw serviceUnavailable("Project top-ups are not set up");
  }
  const metadata: CmoCheckoutMetadata & { kind: "top-up" } = {
    projectId: cuso.projectId,
    organizationId,
    userId: input.userId,
    kind: "top-up",
  };
  const url = await createPolarCheckout({
    productIds: topUps.map((pack) => pack.productId),
    organizationId,
    metadata,
    returnUrl: input.returnUrl,
  });
  return { url };
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
  const metadata = cmoCheckoutMetadataSchema.safeParse(order.metadata);
  if (!metadata.success) {
    reportUnusableEvent(event, "no CMO checkout metadata", extra);
    return;
  }
  const { organizationId, projectId } = metadata.data;
  if (order.customer.external_id !== organizationId) {
    reportUnusableEvent(
      event,
      "the Polar customer is not the organization of the checkout",
      extra,
    );
    return;
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace: { organizationId } },
    select: { id: true },
  });
  if (!project) {
    reportUnusableEvent(event, "unknown organization or Project", extra);
    return;
  }

  const amount = convertCreditsToCents(pack.data.credits);
  // An order has no paid date of its own: the event's timestamp stands in.
  const expiresAt = new Date(event.timestamp);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  await grantCmoCredits({
    amount,
    expiresAt,
    organizationId,
    projectId,
    referenceId: `${order.id}:0`,
    referenceNote: order.product.name,
    referenceType: CreditBucketReferenceType.PROJECT_TOP_UP,
  });
}
