import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  type PolarWebhookEvent,
  verifyPolarWebhook,
} from "@/clients/polar.client";
import { forbidden, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { accepted, ok } from "@/helpers/response";
import { defaultValidationHook } from "@/lib/hono";
import {
  handlePolarOrderPaid,
  handlePolarSubscriptionEvent,
} from "@/services/cmo-subscription.service";

/** The Polar events Core acts on; every other type is acknowledged with 202. */
const HANDLED_EVENT_TYPES = new Set<PolarWebhookEvent["type"]>([
  "order.paid",
  "order.refunded",
  "subscription.created",
  "subscription.active",
  "subscription.updated",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.past_due",
  "subscription.revoked",
]);

const receivedSchema = z.object({ received: z.boolean() });

const route = createRoute({
  method: "post",
  path: "/polar",
  tags: ["Webhooks"],
  security: [],
  description:
    "Receive Polar events for CMO subscriptions and Project top-ups. Verifies the raw body with POLAR_WEBHOOK_SECRET and the webhook-id, webhook-timestamp and webhook-signature headers. Acknowledges event types it does not handle with 202.",
  responses: {
    200: jsonSuccessResponse(receivedSchema, "Received"),
    202: {
      description: "Event type not handled",
      content: { "application/json": { schema: receivedSchema } },
    },
    403: jsonErrorResponse("Invalid webhook signature"),
    500: jsonErrorResponse("Internal Server Error"),
    503: jsonErrorResponse("Polar is not configured"),
  },
});

const app = new OpenAPIHono({ defaultHook: defaultValidationHook });

app.openapi(route, async (c) => {
  const verified = await verifyPolarWebhook(await c.req.text(), {
    "webhook-id": c.req.header("webhook-id") ?? "",
    "webhook-timestamp": c.req.header("webhook-timestamp") ?? "",
    "webhook-signature": c.req.header("webhook-signature") ?? "",
  });
  if (verified.isErr()) {
    if (verified.error === "not_configured") {
      throw serviceUnavailable("Polar is not configured");
    }
    if (verified.error === "invalid_signature") {
      throw forbidden("Invalid Polar webhook signature");
    }
    return accepted(c, { received: true });
  }
  const event = verified.value;
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return accepted(c, { received: true });
  }
  switch (event.type) {
    case "order.paid":
      await handlePolarOrderPaid(event);
      break;
    case "subscription.created":
    case "subscription.active":
    case "subscription.updated":
    case "subscription.canceled":
    case "subscription.uncanceled":
    case "subscription.past_due":
    case "subscription.revoked":
      await handlePolarSubscriptionEvent(event);
      break;
  }
  return ok(c, { received: true });
});

export default app;
