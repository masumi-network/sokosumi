import "server-only";

import * as Sentry from "@sentry/nextjs";

import { getEnvSecrets } from "@/config/env.secrets";

/**
 * Base function to call marketing and analytics webhooks.
 * Handles webhook URL resolution and error reporting via Sentry.
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
) {
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

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      body: JSON.stringify({ userId, ...payload }),
    });
    if (!res.ok) {
      throw new Error(`Response is not okay from ${webhookType} webhook`);
    }
  } catch (error) {
    Sentry.captureMessage(`Failed to call ${webhookType} webhook`, {
      level: "warning",
      user: {
        userId,
      },
      extra: {
        error: String(error),
      },
    });
  }
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
