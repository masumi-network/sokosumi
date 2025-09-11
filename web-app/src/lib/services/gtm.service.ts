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
 * Calls the marketing opt in webhook
 * This function must be called in `signUpEmail` action.
 * @param email - The email of the user
 * @param name - The name of the user
 */
export async function callMarketingOptInWebHook(
  email: string,
  name: string,
  marketingOptIn: boolean = false,
) {
  const webhookUrl = getEnvSecrets().MARKETING_OPT_IN_WEB_HOOK;
  if (!webhookUrl) {
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      body: JSON.stringify({ email, name, marketingOptIn }),
    });
    if (!res.ok) {
      throw new Error("Response is not okay from marketing opt in webhook");
    }
  } catch (error) {
    Sentry.captureMessage("Failed to call marketing opt in webhook", {
      level: "warning",
      user: {
        email,
        name,
      },
      extra: {
        error: String(error),
      },
    });
  }
}
