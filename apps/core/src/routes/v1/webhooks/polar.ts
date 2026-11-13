import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { verifyPolarWebhook } from "@/clients/polar.client";
import { forbidden, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { accepted, ok } from "@/helpers/response";
import { defaultValidationHook } from "@/lib/hono";
import {
  handlePolarOrderPaid,
  handlePolarOrderRefunded,
  handlePolarPlanChangePaid,
  handlePolarSubscriptionEvent,
  isCmoSubscriptionEvent,
} from "@/services/cmo-subscription.service";
import { handlePolarTopUpPaid } from "@/services/cmo-top-up.service";

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
  // The Polar events Core acts on; every other type is acknowledged with 202.
  if (event.type === "order.paid") {
    // A one-time purchase is a Project top-up; a plan change has its own
    // grant; every other order is a plan's month.
    if (event.data.billing_reason === "purchase") {
      await handlePolarTopUpPaid(event);
    } else if (event.data.billing_reason === "subscription_update") {
      await handlePolarPlanChangePaid(event);
    } else {
      await handlePolarOrderPaid(event);
    }
  } else if (event.type === "order.refunded") {
    await handlePolarOrderRefunded(event);
  } else if (isCmoSubscriptionEvent(event)) {
    await handlePolarSubscriptionEvent(event);
  } else {
    return accepted(c, { received: true });
  }
  return ok(c, { received: true });
});

export default app;
