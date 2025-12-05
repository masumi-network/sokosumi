import { TIME } from "@/config/constants";
import { getEnv } from "@/config/env";

const WEBHOOK_TIMEOUT_MS = TIME.WEBHOOK_TIMEOUT * 1000;

export type WebhookType = "userCreated" | "userUpdated" | "accountCreated";

export const webhookClient = (() => {
  /**
   * Calls a webhook URL with timeout protection
   * Fire-and-forget pattern - logs errors but doesn't throw
   */
  async function call(
    webhookUrl: string,
    payload: Record<string, unknown>,
    webhookType: WebhookType,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Sokosumi-Core-API/1.0",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(
          `Webhook ${webhookType} returned non-OK status: ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          console.error(
            `Webhook ${webhookType} timed out after ${WEBHOOK_TIMEOUT_MS}ms`,
          );
        } else {
          console.error(`Error calling ${webhookType} webhook:`, error.message);
        }
      } else {
        console.error(`Unknown error calling ${webhookType} webhook`);
      }
    }
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
