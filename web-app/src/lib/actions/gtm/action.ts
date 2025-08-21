"use server";

import * as Sentry from "@sentry/nextjs";

import { getEnvSecrets } from "@/config/env.secrets";
import { ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { getSession } from "@/lib/auth/utils";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function callAfterAgentHiredWebHook(): Promise<
  Result<void, ActionError>
> {
  const session = await getSession();
  if (!session) {
    return Err({
      message: "No session found",
      code: CommonErrorCode.UNAUTHENTICATED,
    });
  }
  const userEmail = session.user.email;

  try {
    const res = await fetch(getEnvSecrets().AFTER_AGENT_HIRED_WEB_HOOK, {
      method: "POST",
      body: JSON.stringify({ email: userEmail }),
    });
    if (!res.ok) {
      throw new Error("Response is not okay from after agent hired webhook");
    }
    return Ok();
  } catch (error) {
    Sentry.captureMessage("Failed to call after agent hired webhook", {
      level: "warning",
      user: {
        email: userEmail,
      },
      extra: {
        error: String(error),
      },
    });
    return Err({
      message: "Failed to call after agent hired webhook",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
