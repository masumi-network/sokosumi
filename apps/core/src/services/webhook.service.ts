import { z } from "@hono/zod-openapi";

import { getEnv } from "@/config/env";

// Webhook configuration constants
const WEBHOOK_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Internal validation schema for user webhook payloads
 * Not exported - validation is an implementation detail
 */
const marketingOptInUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  marketingOptIn: z.boolean(),
});

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
 * Base function to call webhooks with timeout protection.
 * Fire-and-forget pattern - does not throw errors, only logs them.
 *
 * @param webhookUrl - The webhook URL to call
 * @param payload - The payload to send
 * @param webhookType - The type of webhook for logging
 * @private
 */
async function callWebHook(
  webhookUrl: string,
  payload: Record<string, unknown>,
  webhookType: "userCreated" | "userUpdated" | "accountCreated" | "agentHired",
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

    // Consume response body to prevent connection leaks
    await consumeResponseBody(response);

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
 * Triggers the user created webhook when a new user signs up.
 * Validates user data before sending.
 *
 * @param user - The user object from the database hook
 */
export async function callUserCreatedWebHook(user: unknown): Promise<void> {
  const env = getEnv();
  const webhookUrl = env.WEBHOOK_USER_CREATED;
  if (!webhookUrl) return;

  const { success, data, error } = marketingOptInUserSchema.safeParse(user);
  if (!success) {
    console.error("Invalid user data for user created webhook:", error);
    return;
  }

  await callWebHook(
    webhookUrl,
    {
      userId: data.id,
      email: data.email,
      name: data.name,
      marketingOptIn: data.marketingOptIn,
    },
    "userCreated",
  );
}

/**
 * Triggers the user updated webhook when an existing user modifies their profile.
 * Validates user data before sending.
 *
 * @param user - The user object from the database hook
 */
export async function callUserUpdatedWebHook(user: unknown): Promise<void> {
  const env = getEnv();
  const webhookUrl = env.WEBHOOK_USER_UPDATED;
  if (!webhookUrl) return;

  const { success, data, error } = marketingOptInUserSchema.safeParse(user);
  if (!success) {
    console.error("Invalid user data for user updated webhook:", error);
    return;
  }

  await callWebHook(
    webhookUrl,
    {
      userId: data.id,
      email: data.email,
      name: data.name,
      marketingOptIn: data.marketingOptIn,
    },
    "userUpdated",
  );
}

/**
 * Triggers the account created webhook when a user links an OAuth account.
 *
 * @param userId - The unique identifier of the user
 * @param providerId - The OAuth provider identifier (e.g., "google", "microsoft")
 */
export async function callAccountCreatedWebHook(
  userId: string,
  providerId: string,
): Promise<void> {
  const env = getEnv();
  const webhookUrl = env.WEBHOOK_ACCOUNT_CREATED;
  if (!webhookUrl) return;

  await callWebHook(
    webhookUrl,
    {
      userId,
      providerId,
    },
    "accountCreated",
  );
}

/**
 * Triggers the agent hired webhook when a user hires an agent.
 *
 * @param userId - The unique identifier of the user who hired the agent
 * @param email - The email address of the user
 */
export async function callAgentHiredWebHook(
  userId: string,
  email: string,
): Promise<void> {
  const env = getEnv();
  const webhookUrl = env.WEBHOOK_AGENT_HIRED;
  if (!webhookUrl) return;

  await callWebHook(
    webhookUrl,
    {
      userId,
      email,
    },
    "agentHired",
  );
}
