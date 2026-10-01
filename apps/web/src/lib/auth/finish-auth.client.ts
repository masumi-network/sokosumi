import * as Sentry from "@sentry/nextjs";

import { authClient } from "@/lib/auth/auth.client";
import {
  createAuthSessionGetter,
  normalizeAuthReturnUrl,
  waitForAuthSession,
} from "@/lib/auth/auth.utils";
import { fireGTMEvent } from "@/lib/gtm-events";
import type { AuthMethodId } from "@/lib/schemas/auth";

interface FinishAuthInPlaceOptions {
  /** Which conversion to count. Matches SocialAuthCallback's prop. */
  eventType: "signIn" | "signUp";
  provider: AuthMethodId;
  returnUrl: string | undefined;
  /**
   * What the sign-in or sign-up call returned. Required: it is how the finish
   * learns that the OAuth provider has already answered.
   */
  result: unknown;
  /** Work that must be on its way before the page leaves. */
  beforeLeaving?: () => Promise<unknown>;
}

/**
 * When the page carries an OAuth request, Core's OAuth provider answers the
 * sign-in or sign-up itself with `{ redirect: true, url }`, and Better Auth's
 * client is already navigating there.
 */
function isOAuthProviderRedirect(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "redirect" in result &&
    result.redirect === true &&
    "url" in result &&
    typeof result.url === "string"
  );
}

function countConversion(
  eventType: FinishAuthInPlaceOptions["eventType"],
  provider: AuthMethodId,
): void {
  switch (eventType) {
    case "signUp":
      fireGTMEvent.signUp(provider);
      break;
    case "signIn":
      fireGTMEvent.signIn(provider);
      break;
  }
}

/**
 * Completes a sign-in or sign-up that did not hand Better Auth a
 * `callbackURL` (credential sign-in, credential sign-up, passkey, email
 * code): wait for the session cookie to settle, count the conversion only if
 * a session exists, then navigate to the destination.
 *
 * When the OAuth provider has already answered, the page is leaving for that
 * answer and this navigates nowhere: a second navigation would deliver the
 * authorization code twice, and Core revokes a confidential client's tokens
 * for that. The provider only answers once a session exists, so the
 * conversion is counted at once; anything later races the unload.
 *
 * The navigation is a full document load, not `router.replace`. The Next
 * client router cache still holds the pre-login middleware result for the
 * destination (anonymous `/` -> `/signin`), so a soft nav bounces straight
 * back to the sign-in form. A full load re-runs middleware with the new
 * session cookie. `replace` keeps `/signin` off the history stack. This
 * lands directly on the app, not the marketing `/auth/callback` page, so no
 * hero swap or interstitial. Same pattern as the workspace-gate leave in
 * identity-onboarding-form.client.tsx. Social sign-in cannot use this
 * — the provider round trip lands on `/auth/callback/signin` instead.
 */
export async function finishAuthInPlace({
  eventType,
  provider,
  returnUrl,
  result,
  beforeLeaving,
}: FinishAuthInPlaceOptions): Promise<void> {
  if (isOAuthProviderRedirect(result)) {
    countConversion(eventType, provider);
    await beforeLeaving?.();
    return;
  }

  await beforeLeaving?.();
  const session = await waitForAuthSession({
    context: eventType === "signUp" ? "signup" : "login",
    getSession: createAuthSessionGetter(() => authClient.getSession()),
    logWarning: (message) => {
      Sentry.captureMessage(message, { level: "warning" });
    },
  });

  if (session) {
    countConversion(eventType, provider);
  }
  window.location.replace(normalizeAuthReturnUrl(returnUrl));
}
