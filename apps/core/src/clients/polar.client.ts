import { PolarClientError } from "@polar-sh/sdk";
import {
  createPolar,
  errors,
  type models,
  webhooks,
} from "@polar-sh/sdk/2026-10";
import { err, ok, type Result } from "neverthrow";

import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";

/**
 * Core's one door to Polar (ADR 0068): nothing else imports `@polar-sh/sdk`,
 * and tests replace this module instead of the SDK.
 */

export type PolarProduct = models.Product;
export type PolarSubscription = models.Subscription;
export type PolarWebhookEvent = webhooks.WebhookPayload;
export type PolarWebhookError =
  | "not_configured"
  | "invalid_signature"
  | "unsupported_event";

interface PolarConfig {
  accessToken: string;
  environment: "sandbox" | "production";
  webhookSecret: string;
}

function getPolarConfig(): PolarConfig | null {
  const env = getEnv();
  if (
    !env.POLAR_ACCESS_TOKEN ||
    !env.POLAR_WEBHOOK_SECRET ||
    !env.POLAR_ENVIRONMENT
  ) {
    return null;
  }
  return {
    accessToken: env.POLAR_ACCESS_TOKEN,
    environment: env.POLAR_ENVIRONMENT,
    webhookSecret: env.POLAR_WEBHOOK_SECRET,
  };
}

/** The SDK client, or a 503 when this deployment has no Polar settings. */
function requirePolar() {
  const config = getPolarConfig();
  if (!config) throw serviceUnavailable("Polar is not configured");
  return createPolar({
    accessToken: config.accessToken,
    environment: config.environment,
  });
}

/** Every product of the Polar organization that is not archived. */
export async function listPolarProducts(): Promise<PolarProduct[]> {
  const products: PolarProduct[] = [];
  for await (const product of requirePolar().products.iterList({
    is_archived: false,
    limit: 100,
  })) {
    products.push(product);
  }
  return products;
}

export interface PolarCheckoutInput {
  /** Copied by Polar to the order (and the subscription) of this checkout. */
  metadata: Record<string, string>;
  /** The Polar customer: its external id is the organization's id. */
  organizationId: string;
  /** The person picks one in the checkout; the first is preselected. */
  productIds: string[];
  /** Where the person lands after paying (Polar's `success_url`). */
  returnUrl: string;
  /** Where Polar's back link leads without paying (its `return_url`). */
  backUrl: string;
}

/** Starts a hosted checkout, trial and discount codes off; returns its URL. */
export async function createPolarCheckout(
  input: PolarCheckoutInput,
): Promise<string> {
  const checkout = await requirePolar().checkouts.create({
    products: input.productIds,
    external_customer_id: input.organizationId,
    metadata: input.metadata,
    success_url: input.returnUrl,
    return_url: input.backUrl,
    allow_discount_codes: false,
    allow_trial: false,
  });
  return checkout.url;
}

/**
 * Ends a subscription at Polar now: no further charge, no refund, and it
 * cannot be undone. One that Polar already ended counts as done.
 */
export async function revokePolarSubscription(
  polarSubscriptionId: string,
): Promise<void> {
  try {
    await requirePolar().subscriptions.revoke(polarSubscriptionId);
  } catch (error) {
    if (error instanceof errors.AlreadyCanceledSubscription) return;
    throw error;
  }
}

/** Why Polar left a subscription's plan as it was. */
export type PolarPlanChangeError = "payment_failed" | "not_changeable";

/**
 * Moves a subscription to another plan product. An upgrade (`upgradeFromCredits`
 * set) applies now and Polar invoices the prorated difference at once; the
 * old plan's monthly credits go into the subscription's metadata, where the
 * paid `subscription_update` order's grant reads them. Without it the change
 * waits for the next period as Polar's pending update. Answers the
 * subscription as Polar holds it now.
 */
export async function changePolarSubscriptionPlan(input: {
  polarSubscriptionId: string;
  productId: string;
  upgradeFromCredits?: number;
}): Promise<Result<PolarSubscription, PolarPlanChangeError>> {
  const polar = requirePolar();
  try {
    if (input.upgradeFromCredits === undefined) {
      return ok(
        await polar.subscriptions.update(input.polarSubscriptionId, {
          product_id: input.productId,
          proration_behavior: "next_period",
        }),
      );
    }
    // Polar replaces the metadata: keep what the checkout wrote.
    const { metadata } = await polar.subscriptions.get(
      input.polarSubscriptionId,
    );
    return ok(
      await polar.subscriptions.update(input.polarSubscriptionId, {
        product_id: input.productId,
        proration_behavior: "invoice",
        metadata: { ...metadata, upgradeFromCredits: input.upgradeFromCredits },
      }),
    );
  } catch (error) {
    return planChangeError(error);
  }
}

function planChangeError(error: unknown): Result<never, PolarPlanChangeError> {
  if (error instanceof errors.SubscriptionsUpdate402Error) {
    return err("payment_failed");
  }
  if (
    error instanceof errors.SubscriptionsUpdate403Error ||
    error instanceof errors.SubscriptionsUpdate409Error
  ) {
    return err("not_changeable");
  }
  throw error;
}

/**
 * Drops the subscription's scheduled change (a downgrade waiting for the next
 * period), so the current plan renews as it is. Answers the subscription
 * as Polar holds it now.
 */
export async function clearPolarPendingPlanChange(
  polarSubscriptionId: string,
): Promise<Result<PolarSubscription, PolarPlanChangeError>> {
  const polar = requirePolar();
  try {
    return ok(
      await polar.subscriptions.update(polarSubscriptionId, {
        pending_update: null,
      }),
    );
  } catch (error) {
    return planChangeError(error);
  }
}

/**
 * A customer portal link for the organization, Polar's customer: cancel,
 * payment method and invoices of every Cuso it pays for. Null when the
 * organization never paid at Polar.
 */
export async function createPolarCustomerPortalUrl(input: {
  organizationId: string;
  returnUrl: string;
}): Promise<string | null> {
  try {
    const session = await requirePolar().customerSessions.create({
      external_customer_id: input.organizationId,
      return_url: input.returnUrl,
    });
    return session.customer_portal_url;
  } catch (error) {
    // Polar does not know that external customer id (404 or 422).
    if (
      error instanceof PolarClientError &&
      (error.statusCode === 404 || error.statusCode === 422)
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Checks a webhook's signature against the raw body and returns its event.
 * `unsupported_event` is a signed body this API version cannot read; it can
 * never succeed, so callers acknowledge it.
 */
export async function verifyPolarWebhook(
  rawBody: string,
  headers: Record<string, string>,
): Promise<Result<PolarWebhookEvent, PolarWebhookError>> {
  const config = getPolarConfig();
  if (!config) return err("not_configured");
  try {
    return ok(
      await webhooks.validateEvent(rawBody, headers, config.webhookSecret),
    );
  } catch (error) {
    if (error instanceof webhooks.PolarWebhookVerificationError) {
      return err("invalid_signature");
    }
    if (error instanceof webhooks.PolarWebhookError) {
      return err("unsupported_event");
    }
    throw error;
  }
}
