import "server-only";

import * as Sentry from "@sentry/nextjs";

import { getEnvSecrets } from "@/config/env.secrets";

// Webhook configuration constants
const WEBHOOK_TIMEOUT_MS = 10000; // 10 seconds
const WEBHOOK_MAX_RETRIES = 3;
const WEBHOOK_RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s

/**
 * Helper function to sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Consumes the response body to prevent connection leaks.
 * Reads the body even if we don't use it.
 */
async function consumeResponseBody(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text;
  } catch {
    return null;
  }
}

/**
 * Calls a webhook with retry logic, timeout, and proper error handling.
 * Implements exponential backoff retry strategy.
 *
 * @param webhookUrl - The webhook URL to call
 * @param payload - The payload to send
 * @param webhookType - The type of webhook for error reporting
 * @param userId - The user ID for error reporting
 * @returns Promise that resolves when the webhook call succeeds or all retries are exhausted
 * @private
 */
async function callWebHookWithRetry(
  webhookUrl: string,
  payload: Record<string, unknown>,
  webhookType: "userCreated" | "userUpdated" | "accountCreated" | "agentHired",
  userId: string,
): Promise<void> {
  let lastError: Error | null = null;
  let lastResponse: Response | null = null;
  let lastResponseBody: string | null = null;

  for (let attempt = 0; attempt <= WEBHOOK_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Sokosumi-Webhook/1.0",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Consume response body to prevent connection leaks
      lastResponseBody = await consumeResponseBody(response);
      lastResponse = response;

      if (response.ok) {
        // Success - no need to retry
        return;
      }

      // Non-ok response - will retry
      lastError = new Error(
        `Response is not okay from ${webhookType} webhook: ${response.status} ${response.statusText}`,
      );
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          lastError = new Error(
            `Webhook request timed out after ${WEBHOOK_TIMEOUT_MS}ms`,
          );
        } else {
          lastError = error;
        }
      } else {
        lastError = new Error(String(error));
      }
    }

    // If this was the last attempt, break and report error
    if (attempt === WEBHOOK_MAX_RETRIES) {
      break;
    }

    // Wait before retrying (exponential backoff)
    const delay =
      WEBHOOK_RETRY_DELAYS[attempt] ??
      WEBHOOK_RETRY_DELAYS[WEBHOOK_RETRY_DELAYS.length - 1];
    await sleep(delay);
  }

  // All retries exhausted - report to Sentry with detailed context
  const errorContext: Record<string, unknown> = {
    webhookType,
    webhookUrl,
    userId,
    attempts: WEBHOOK_MAX_RETRIES + 1,
    error: lastError?.message ?? "Unknown error",
  };

  if (lastResponse) {
    errorContext.responseStatus = lastResponse.status;
    errorContext.responseStatusText = lastResponse.statusText;
    if (lastResponseBody) {
      // Truncate response body if too long (max 500 chars)
      errorContext.responseBody =
        lastResponseBody.length > 500
          ? `${lastResponseBody.substring(0, 500)}... (truncated)`
          : lastResponseBody;
    }
  }

  Sentry.captureMessage(`Failed to call ${webhookType} webhook`, {
    level: "warning",
    user: {
      userId,
    },
    extra: errorContext,
  });
}

/**
 * Base function to call marketing and analytics webhooks.
 * Handles webhook URL resolution and error reporting via Sentry.
 * Uses retry logic with exponential backoff and timeout protection.
 *
 * @param userId - The unique identifier of the user triggering the webhook
 * @param payload - Additional data to include in the webhook payload
 * @param webhookType - The type of webhook to trigger
 * @private
 */
async function callWebHook(
  userId: string,
  payload: Record<string, unknown>,
  webhookType: "userCreated" | "userUpdated" | "accountCreated" | "agentHired",
): Promise<void> {
  let webhookUrl: string | undefined;
  switch (webhookType) {
    case "userCreated":
      webhookUrl = getEnvSecrets().USER_CREATED_WEBHOOK;
      break;
    case "userUpdated":
      webhookUrl = getEnvSecrets().USER_UPDATED_WEBHOOK;
      break;
    case "accountCreated":
      webhookUrl = getEnvSecrets().ACCOUNT_CREATED_WEBHOOK;
      break;
    case "agentHired":
      webhookUrl = getEnvSecrets().AGENT_HIRED_WEBHOOK;
      break;
  }
  if (!webhookUrl) return;

  await callWebHookWithRetry(
    webhookUrl,
    { userId, ...payload },
    webhookType,
    userId,
  );
}

/**
 * Triggers the agent hired webhook to track when a user hires an agent.
 * This function should be called in the `startJob` action after successful agent hiring.
 *
 * @param userId - The unique identifier of the user who hired the agent
 * @param email - The email address of the user
 * @returns Promise that resolves when the webhook call completes
 */
export async function callAgentHiredWebHook(userId: string, email: string) {
  return callWebHook(userId, { email }, "agentHired");
}

/**
 * Triggers the user created webhook when a new user signs up via email/password.
 * This webhook sends user registration data to marketing and analytics platforms.
 *
 * @param userId - The unique identifier of the newly created user
 * @param email - The email address of the user
 * @param name - The full name of the user
 * @param marketingOptIn - Whether the user consented to receive marketing communications
 * @returns Promise that resolves when the webhook call completes
 */
export async function callUserCreatedWebHook(
  userId: string,
  email: string,
  name: string,
  marketingOptIn: boolean,
) {
  return callWebHook(userId, { email, name, marketingOptIn }, "userCreated");
}

/**
 * Triggers the user updated webhook when an existing user modifies their profile information.
 * This webhook syncs updated user data to marketing and analytics platforms.
 *
 * @param userId - The unique identifier of the user being updated
 * @param email - The updated email address of the user
 * @param name - The updated full name of the user
 * @param marketingOptIn - The updated marketing consent preference
 * @returns Promise that resolves when the webhook call completes
 */
export async function callUserUpdatedWebHook(
  userId: string,
  email: string,
  name: string,
  marketingOptIn: boolean,
) {
  return callWebHook(userId, { email, name, marketingOptIn }, "userUpdated");
}

/**
 * Triggers the account created webhook when a user signs up or links a social provider account.
 * This webhook tracks OAuth/social authentication events for marketing and analytics purposes.
 *
 * @param userId - The unique identifier of the user
 * @param providerId - The OAuth provider identifier (e.g., "google", "microsoft", "github")
 * @returns Promise that resolves when the webhook call completes
 */
export async function callAccountCreatedWebHook(
  userId: string,
  providerId: string,
) {
  return callWebHook(userId, { providerId }, "accountCreated");
}
