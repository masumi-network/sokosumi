"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getEnvPublicConfig } from "@/config/env.public";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { getSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import type { UserOnboardingRequest } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services";
import { SUBSCRIPTION_ONBOARDING_GATE_SESSION_COOKIE_NAME } from "@/lib/subscription-onboarding-gate-cookie";

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

export async function completeOnboarding(
  profile?: UserOnboardingRequest["profile"],
): Promise<ActionResultDto<{ redirectUrl: string }, ActionError>> {
  try {
    // Always complete through Core so DB `onboardingCompleted` is set even
    // when there are no profile answers (free-upgrade gate / Stripe return).
    // Skipping Core left the BA-only path as a second write source and made
    // partial failure harder to reason about. Empty profile → no metadata
    // patch; Core still flips the flag.
    //
    // BA update below is still required: only that path refreshes the session
    // cookie cache. Stale cache + Core-true is a redirect loop (page trusts
    // Core, app shell trusts session).
    const hasProfile = profile !== undefined && Object.keys(profile).length > 0;
    await coreClient.completeMyOnboarding(hasProfile ? { profile } : undefined);

    await userService.markOnboardingCompleteForMe();

    const session = await getSession();
    if (session) {
      await setSubscriptionOnboardingGateCookieForSessionId(session.session.id);
    }

    revalidatePath("/");
    return toActionResult(ok({ redirectUrl: "/tasks" }));
  } catch (error) {
    console.error("Error completing onboarding:", error);
    const t = await getTranslations("Onboarding.Actions.Errors");
    return toActionResult(
      err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: error instanceof Error ? error.message : t("failedToComplete"),
      }),
    );
  }
}
