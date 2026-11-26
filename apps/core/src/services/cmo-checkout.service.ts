import * as Sentry from "@sentry/node";

import {
  createPolarCheckout,
  ensurePolarOrganizationCustomer,
  type PolarBillingAddress,
  updatePolarCustomerBilling,
} from "@/clients/polar.client";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import { serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { type CmoPlan, getCmoCatalog } from "@/services/cmo-catalog.service";
import {
  CmoConflictError,
  type Cuso,
  type CusoTarget,
  cmoPayer,
  requireCuso,
} from "@/services/cmo-cuso.service";
import type { CmoCheckoutMetadata } from "@/services/polar-subscription.service";
import { stripeCustomerBillingService } from "@/services/stripe-customer-billing.service";

/**
 * Starts Polar's hosted checkout for a Cuso (ADR 0068), a plan or a top-up:
 * any member of his organization may pay, always as the organization's Polar
 * customer (`polarCustomerFor`); the metadata is what the paid order's grant reads
 * (`cmoCheckoutMetadataSchema`). `productsFor` refuses what the Cuso may not
 * buy and lists the products, the preselected one first.
 */
/** CMO.xyz's GA4 ids for a checkout made with analytics consent. */
export interface CheckoutAnalytics {
  clientId: string;
  sessionId?: string | undefined;
}

export async function startCmoCheckout(
  input: CusoTarget & {
    returnUrl: string;
    backUrl: string;
    analytics?: CheckoutAnalytics | undefined;
  },
  kind: "plan" | "top-up",
  productsFor: (cuso: Cuso) => Promise<string[]>,
): Promise<{ url: string }> {
  if (
    !isFirstPartyAppUrl(input.returnUrl) ||
    !isFirstPartyAppUrl(input.backUrl)
  ) {
    throw new CmoConflictError("The return address must be CMO's own page");
  }
  const cuso = await requireCuso(input);
  const { organizationId } = await cmoPayer(cuso);
  const productIds = await productsFor(cuso);
  const { customerId, customerEmail } = await polarCustomerFor(
    organizationId,
    input.userId,
  );
  const metadata: CmoCheckoutMetadata & {
    kind: typeof kind;
    ga_client_id?: string;
    ga_session_id?: string;
  } = {
    kind,
    projectId: cuso.projectId,
    organizationId,
    userId: input.userId,
    // Read back by `reportPolarEventToGa4` when the order is paid.
    ...(input.analytics
      ? {
          ga_client_id: input.analytics.clientId,
          ...(input.analytics.sessionId
            ? { ga_session_id: input.analytics.sessionId }
            : {}),
        }
      : {}),
  };
  const url = await createPolarCheckout({
    productIds,
    customerId,
    customerEmail,
    metadata,
    returnUrl: input.returnUrl,
    backUrl: input.backUrl,
    // A top-up grants its pack in full whatever was paid: codes for plans only
    // (FREEMONTH: first month free on the monthly plans).
    allowDiscountCodes: kind === "plan",
  });
  return { url };
}

/**
 * The organization's Polar customer and the payer's email for the checkout.
 * Passing the customer's id keeps the order on the organization whatever
 * email the payer types: with only an external id, Polar takes the customer
 * that already has that email (it may be another organization's). Without
 * it there is no checkout; its billing details are copied on a best effort.
 */
async function polarCustomerFor(
  organizationId: string,
  userId: string,
): Promise<{ customerId: string; customerEmail: string }> {
  const [organization, payer] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ]);
  if (!organization || !payer)
    throw new Error("The checkout's organization or payer is missing");
  const customerId = await ensurePolarOrganizationCustomer({
    organizationId,
    name: organization.name,
    ownerEmail: payer.email,
  }).catch((error: unknown) => {
    Sentry.captureException(error, {
      tags: { context: "cmo_polar_customer" },
    });
    throw serviceUnavailable("Polar is not reachable, try again");
  });
  await copyBillingToPolar(customerId, organizationId, organization.name).catch(
    (error: unknown) =>
      Sentry.captureException(error, {
        tags: { context: "cmo_polar_customer_billing" },
      }),
  );
  return { customerId, customerEmail: payer.email };
}

/**
 * Stripe holds the organization's billing details and wins: its address and
 * first tax ID overwrite Polar's, and Polar keeps its own when Stripe has none.
 */
async function copyBillingToPolar(
  customerId: string,
  organizationId: string,
  name: string,
): Promise<void> {
  const { address, taxIds } =
    await stripeCustomerBillingService.getOrganizationBillingDetailsById(
      organizationId,
    );
  // Stripe keeps a partial address with blanks; Polar needs the country and
  // refuses the whole request (the name with it) without one.
  const blankAsNull = (value: string | null) => value || null;
  await updatePolarCustomerBilling(customerId, {
    name,
    billingAddress: address?.country
      ? {
          line1: blankAsNull(address.line1),
          line2: blankAsNull(address.line2),
          city: blankAsNull(address.city),
          // Polar reads a US or Canadian state as "CA" and stores "US-CA".
          state: blankAsNull(address.state),
          postal_code: blankAsNull(address.postalCode),
          // Stripe's ISO country code; Polar refuses one it does not know.
          country: address.country as PolarBillingAddress["country"],
        }
      : null,
    taxId: taxIds[0]?.value ?? null,
  });
}

/**
 * Starts the checkout of a Cuso's CMO plan: the interval's plans, the
 * cheapest first unless the person picked a tier (Polar opens on the first).
 *
 * shortcut: two checkouts opened before either is paid can both be paid;
 * the second subscription is then revoked at Polar, reported and gets no
 * row (`polar_subscription_project_live_key`). Refund it by hand in Polar.
 */
export async function startCmoPlanCheckout(
  input: CusoTarget & {
    interval: CmoPlan["interval"];
    tier?: string | undefined;
    returnUrl: string;
    /** Polar's back link: without the success marker of `returnUrl`. */
    backUrl: string;
    analytics?: CheckoutAnalytics | undefined;
  },
): Promise<{ url: string }> {
  return await startCmoCheckout(input, "plan", async (cuso) => {
    const subscription = await prisma.polarSubscription.findFirst({
      where: { projectId: cuso.projectId, endedAt: null },
      select: { id: true },
    });
    if (subscription) {
      throw new CmoConflictError("This Cuso already has a CMO subscription");
    }
    const plans = (await getCmoCatalog()).plans.filter(
      (plan) => plan.interval === input.interval,
    );
    if (plans.length === 0) {
      throw serviceUnavailable("CMO plans are not set up");
    }
    return [
      ...plans.filter((plan) => plan.tier === input.tier),
      ...plans.filter((plan) => plan.tier !== input.tier),
    ].map((plan) => plan.productId);
  });
}
