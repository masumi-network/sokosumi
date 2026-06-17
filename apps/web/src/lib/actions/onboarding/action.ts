"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getEnvPublicConfig } from "@/config/env.public";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { getSession } from "@/lib/auth/auth.server";
import { userService } from "@/lib/services";
import { SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME } from "@/lib/subscription-onboarding-gate-cookie";
import { Err, Ok, type Result } from "@/lib/ts-res";

const SUBSCRIPTION_ONBOARDING_GATE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

async function setSubscriptionOnboardingGateCookieForSessionId(
  sessionId: string,
): Promise<void> {
  const isProduction =
    getEnvPublicConfig().NEXT_PUBLIC_VERCEL_ENV === "production";
  const cookieStore = await cookies();
  cookieStore.set(SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    maxAge: SUBSCRIPTION_ONBOARDING_GATE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: isProduction,
  });
}

/**
 * Persists that the subscription-only onboarding gate was shown (or suppressed
 * via client localStorage after the user already saw the gate) for the current
 * auth session so the server layout can skip the subscription onboarding loader
 * on subsequent requests. Do not call for restricted org members who never saw
 * checkout — the cookie is session-global and would hide the gate elsewhere.
 */
export async function markSubscriptionOnboardingGateSessionSeen(
  loginId: string,
): Promise<void> {
  const session = await getSession();
  if (!session || session.session.id !== loginId) {
    return;
  }

  await setSubscriptionOnboardingGateCookieForSessionId(loginId);
}

/** Clears the gate cookie when the user moves to a paid flow (allowed in Server Actions only). */
export async function clearSubscriptionOnboardingGateSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME);
}

export async function completeOnboarding(): Promise<
  Result<{ redirectUrl: string }, ActionError>
> {
  try {
    // Mark onboarding as completed without creating anything
    await userService.markOnboardingCompleteForMe();

    const session = await getSession();
    if (session) {
      await setSubscriptionOnboardingGateCookieForSessionId(session.session.id);
    }

    revalidatePath("/");
    return Ok({ redirectUrl: "/tasks" });
  } catch (error) {
    console.error("Error completing onboarding:", error);
    const t = await getTranslations("Onboarding.Actions.Errors");
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: error instanceof Error ? error.message : t("failedToComplete"),
    });
  }
}
