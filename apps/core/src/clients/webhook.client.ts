import * as Sentry from "@sentry/node";
import { buildWebhookFailureContext, postWebhook } from "@sokosumi/utils";

import { WEBHOOK_TIMEOUT_MS, WEBHOOK_USER_AGENT } from "@/config/constants";
import { getEnv } from "@/config/env";

export type WebhookType = "userCreated" | "userUpdated" | "accountCreated";

export const webhookClient = (() => {
  /**
   * Calls a webhook URL with timeout protection.
   * Fire-and-forget pattern - reports failures but doesn't throw. Shared
   * transport and failure-context shaping live in `@sokosumi/utils` so web and
   * core stay in sync; receiver backpressure (queue full) is treated as
   * expected and skipped.
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
      console.warn(
        `Webhook ${webhookType} receiver reported queue backpressure; skipping Sentry report.`,
        {
          responseStatus: result.httpStatus,
          responseStatusText: result.statusText,
        },
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
