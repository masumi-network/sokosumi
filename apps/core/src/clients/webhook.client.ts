import * as Sentry from "@sentry/node";
import { buildWebhookFailureContext, postWebhook } from "@sokosumi/net";

import { WEBHOOK_TIMEOUT_MS, WEBHOOK_USER_AGENT } from "@/config/constants";
import { getEnv } from "@/config/env";
import { recordCoreWarning } from "@/lib/evlog";
import { isTransientFetchError } from "@/lib/external-service-errors";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

export type WebhookType = "userCreated" | "userUpdated" | "accountCreated";

export const webhookClient = (() => {
  /**
   * Calls a webhook URL with timeout protection.
   * Fire-and-forget pattern - reports failures but doesn't throw. Shared
   * transport and failure-context shaping live in `@sokosumi/net`. Receiver
   * backpressure (queue full) is treated as expected and skipped.
   */
  async function call(
    webhookUrl: string,
    payload: Record<string, unknown>,
    webhookType: WebhookType,
  ): Promise<void> {
    const result = await postWebhook(webhookUrl, payload, {
      userAgent: WEBHOOK_USER_AGENT,
      timeoutMs: WEBHOOK_TIMEOUT_MS,
    });

    if (result.status === "ok") return;

    if (result.status === "backpressure") {
      recordCoreWarning(
        { operation: "webhook_call" },
        {
          message:
            "A webhook receiver's queue was full; the call is not reported to Sentry",
          why: "The receiver answered that its queue is full",
          fix: "Nothing, unless it repeats: then check the receiver's queue.",
        },
        { webhookType, status: result.httpStatus },
      );
      return;
    }

    if (isTransientFetchError(result.error)) {
      // The payload carries the user's email, and the URL can carry the
      // receiver's secret: content-free fields only.
      recordCoreWarning(
        { operation: "webhook_call" },
        {
          message:
            "A webhook call failed transiently; it is not reported to Sentry",
          why: "The call timed out or lost its connection",
          fix: "Nothing, unless it repeats: then check that the receiver is up.",
        },
        { webhookType, failure: messageSafeErrorFields(result.error) },
      );
      return;
    }

    Sentry.captureMessage(`Failed to call ${webhookType} webhook`, {
      level: "warning",
      extra: buildWebhookFailureContext(result, { webhookType, webhookUrl }),
    });
  }

  /**
   * Gets webhook URL from environment for a specific webhook type
   */
  function getWebhookUrl(type: WebhookType): string | undefined {
    const env = getEnv();
    switch (type) {
      case "userCreated":
        return env.WEBHOOK_USER_CREATED;
      case "userUpdated":
        return env.WEBHOOK_USER_UPDATED;
      case "accountCreated":
        return env.WEBHOOK_ACCOUNT_CREATED;
    }
  }

  return {
    /**
     * Calls a webhook if configured
     * @param type - The webhook type
     * @param payload - The data to send
     */
    async callWebhook(
      type: WebhookType,
      payload: Record<string, unknown>,
    ): Promise<void> {
      const url = getWebhookUrl(type);
      if (!url) return;
      await call(url, payload, type);
    },
  };
})();
