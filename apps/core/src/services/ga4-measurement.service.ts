import * as Sentry from "@sentry/node";
import { z } from "zod";

import type { PolarWebhookEvent } from "@/clients/polar.client";
import { getEnv } from "@/config/env";
import { planOfProduct } from "@/services/polar-subscription.service";

/** CMO.xyz's GA4 web stream (apps/cmo `GA_MEASUREMENT_ID`). */
const GA4_MEASUREMENT_ID = "G-82QM6MPVWK";

/**
 * CMO.xyz's GA4 ids a checkout carries in its Polar metadata (`ga_client_id`,
 * `ga_session_id`). CMO adds them only when the person allowed analytics, so
 * an order without them is never reported.
 */
export const ga4CheckoutMetadataSchema = z.object({
  ga_client_id: z.string().min(1),
  ga_session_id: z.string().regex(/^\d+$/).optional(),
  userId: z.string().min(1).optional(),
});

type Params = Record<string, string | number | boolean | object[]>;

export interface Ga4Payload {
  client_id: string;
  user_id?: string;
  timestamp_micros: number;
  events: Array<{ name: string; params: Params }>;
}

type OrderEvent = Extract<
  PolarWebhookEvent,
  { type: "order.paid" | "order.refunded" }
>;
type CanceledEvent = Extract<
  PolarWebhookEvent,
  { type: "subscription.canceled" }
>;

/** What GA4 learns from a Polar event; null when it is not reported. */
export function ga4PayloadForPolarEvent(
  event: PolarWebhookEvent,
): Ga4Payload | null {
  if (event.type === "order.paid" || event.type === "order.refunded") {
    return orderPayload(event);
  }
  if (event.type === "subscription.canceled") return cancelPayload(event);
  return null;
}

function orderPayload(event: OrderEvent): Ga4Payload | null {
  const order = event.data;
  // Renewals carry no metadata of their own: the subscription keeps the checkout's.
  const ids = ga4CheckoutMetadataSchema.safeParse({
    ...order.subscription?.metadata,
    ...order.metadata,
  });
  if (!ids.success) return null;
  const plan = order.product
    ? planOfProduct(
        order.product.metadata,
        order.subscription?.recurring_interval ?? null,
      )
    : null;
  const currency = order.currency.toUpperCase();
  const item = {
    item_id:
      plan?.tier ??
      (order.billing_reason === "purchase" ? "top_up" : "unknown"),
    item_name: order.product?.name ?? "CMO.xyz",
    item_category: plan ? "plan" : "top_up",
    ...(plan ? { item_variant: plan.interval } : {}),
    price: order.net_amount / 100,
    quantity: 1,
  };
  // The checkout's session only for the order that checkout made.
  const firstOrder =
    order.billing_reason === "subscription_create" ||
    order.billing_reason === "purchase";
  const session: Params =
    firstOrder && ids.data.ga_session_id
      ? { session_id: ids.data.ga_session_id }
      : {};
  const params: Params =
    event.type === "order.paid"
      ? {
          transaction_id: order.id,
          value: order.net_amount / 100,
          tax: order.tax_amount / 100,
          currency,
          billing_reason: order.billing_reason,
          ...(plan ? { plan: plan.tier, billing_period: plan.interval } : {}),
          items: [item],
        }
      : {
          transaction_id: order.id,
          value: order.refunded_amount / 100,
          currency,
        };
  return payload(
    event,
    ids.data,
    event.type === "order.paid" ? "purchase" : "refund",
    {
      ...params,
      ...session,
    },
  );
}

function cancelPayload(event: CanceledEvent): Ga4Payload | null {
  const subscription = event.data;
  const ids = ga4CheckoutMetadataSchema.safeParse(subscription.metadata);
  if (!ids.success) return null;
  const plan = planOfProduct(
    subscription.product.metadata,
    subscription.recurring_interval,
  );
  return payload(event, ids.data, "subscription_cancel", {
    ...(plan ? { plan: plan.tier, billing_period: plan.interval } : {}),
    cancel_at_period_end: subscription.cancel_at_period_end,
  });
}

function payload(
  event: PolarWebhookEvent,
  ids: z.infer<typeof ga4CheckoutMetadataSchema>,
  name: string,
  params: Params,
): Ga4Payload {
  return {
    client_id: ids.ga_client_id,
    ...(ids.userId ? { user_id: ids.userId } : {}),
    timestamp_micros: new Date(event.timestamp).getTime() * 1000,
    events: [{ name, params: { ...params, engagement_time_msec: 1 } }],
  };
}

/**
 * Sends a Polar event to GA4 through the Measurement Protocol, so a purchase
 * counts even when the browser blocks the tag. Does nothing until
 * GA4_MP_API_SECRET is set; never throws.
 */
export async function reportPolarEventToGa4(
  event: PolarWebhookEvent,
  send: typeof fetch = fetch,
): Promise<void> {
  const { GA4_MP_API_SECRET } = getEnv();
  if (!GA4_MP_API_SECRET) return;
  const body = ga4PayloadForPolarEvent(event);
  if (!body) return;
  const url = new URL("https://www.google-analytics.com/mp/collect");
  url.searchParams.set("measurement_id", GA4_MEASUREMENT_ID);
  url.searchParams.set("api_secret", GA4_MP_API_SECRET);
  try {
    const response = await send(url, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`GA4 answered ${response.status}`);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "ga4_measurement_protocol" },
      extra: { polarEvent: event.type },
    });
  }
}
