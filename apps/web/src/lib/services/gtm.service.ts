import "server-only";

import * as Sentry from "@sentry/nextjs";
import { buildWebhookFailureContext, postWebhook } from "@sokosumi/utils";

import { getEnvSecrets } from "@/config/env.secrets";

// User-Agent identifying webhook calls originating from the web app.
const WEBHOOK_USER_AGENT = "Sokosumi-Webhook/1.0";

/**
 * Triggers the agent hired webhook to track when a user hires an agent.
 * This function should be called in the `startJob` action after successful agent hiring.
 *
 * Failures are reported to Sentry as warnings; receiver backpressure (queue
 * full) is treated as expected and skipped. Shared transport lives in
 * `@sokosumi/utils` so web and core stay in sync.
 *
 * @param userId - The unique identifier of the user who hired the agent
 * @param email - The email address of the user
 * @returns Promise that resolves when the webhook call completes
 */
export async function callAgentHiredWebHook(userId: string, email: string) {
  const webhookUrl = getEnvSecrets().AGENT_HIRED_WEBHOOK;
  if (!webhookUrl) return;

  const result = await postWebhook(
    webhookUrl,
    { userId, email },
    { userAgent: WEBHOOK_USER_AGENT },
  );

  if (result.status === "ok") return;

  if (result.status === "backpressure") {
    console.warn(
      "Webhook agentHired receiver reported queue backpressure; skipping Sentry report.",
      {
        responseStatus: result.httpStatus,
        responseStatusText: result.statusText,
      },
    );
    return;
  }

  // Report failure to Sentry with detailed context.
  Sentry.captureMessage("Failed to call agentHired webhook", {
    level: "warning",
    user: {
      userId,
    },
    extra: buildWebhookFailureContext(result, {
      webhookType: "agentHired",
      webhookUrl,
      userId,
    }),
  });
}
