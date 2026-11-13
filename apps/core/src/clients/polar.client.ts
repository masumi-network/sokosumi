import { createPolar, type models, webhooks } from "@polar-sh/sdk/2026-10";
import { err, ok, type Result } from "neverthrow";

import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";

/**
 * Core's one door to Polar (ADR 0068): nothing else imports `@polar-sh/sdk`,
 * and tests replace this module instead of the SDK.
 */

export type PolarProduct = models.Product;
export type PolarCheckoutCreate = models.CheckoutCreate;
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

/** Opens a hosted checkout and returns the address the person pays at. */
export async function createPolarCheckout(
  checkout: PolarCheckoutCreate,
): Promise<string> {
  return (await requirePolar().checkouts.create(checkout)).url;
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
