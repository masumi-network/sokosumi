import "server-only";

import * as Sentry from "@sentry/nextjs";

import { getEnvSecrets } from "@/config/env.secrets";

/**
 * Calls the after agent hired webhook
 * This function must be called in `startJob` action.
 * @param email - The email of the user
 */
export async function callAfterAgentHiredWebHook(email: string) {
  const webhookUrl = getEnvSecrets().AFTER_AGENT_HIRED_WEB_HOOK;
  if (!webhookUrl) {
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      throw new Error("Response is not okay from after agent hired webhook");
    }
  } catch (error) {
    Sentry.captureMessage("Failed to call after agent hired webhook", {
      level: "warning",
      user: {
        email,
      },
      extra: {
        error: String(error),
      },
    });
  }
}

/**
 * Base function to call the marketing opt in webhook
 */
async function callMarketingOptInWebHook(
  userId: string,
  payload: Record<string, unknown>,
) {
  const webhookUrl = getEnvSecrets().MARKETING_OPT_IN_WEB_HOOK;
  if (!webhookUrl) return;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      body: JSON.stringify({ userId, ...payload }),
    });
    if (!res.ok) {
      throw new Error("Response is not okay from marketing opt in webhook");
    }
  } catch (error) {
    Sentry.captureMessage("Failed to call marketing opt in webhook", {
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
 * Calls the marketing opt in webhook when a user signs up or updates their email.
 * Should be used when a user signs up or updates their email.
 *
 * @param userId - The id of the user
 * @param email - The email of the user
 * @param name - The name of the user
 * @param marketingOptIn - Whether the user opted in to marketing
 */
export async function callMarketingOptInWebHookEmail(
  userId: string,
  email: string,
  name: string,
  marketingOptIn: boolean,
) {
  return callMarketingOptInWebHook(userId, { email, name, marketingOptIn });
}

/**
 * Calls the marketing opt in webhook when a user signs up or links an account with a social provider.
 * Should be used when a user authenticates through OAuth/social login.
 *
 * @param userId - The unique identifier for the user
 * @param providerId - The provider id used for authentication (e.g., "credential", "google", "microsoft")
 *
 * Attempts to POST to the marketing opt-in webhook with user and provider data. Errors are logged using Sentry.
 */
export async function callMarketingOptInWebHookSocialProvider(
  userId: string,
  providerId: string,
) {
  return callMarketingOptInWebHook(userId, { providerId });
}
