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
  /** What the sign-in or sign-up call returned. */
  result?: unknown;
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

/**
 * Completes a sign-in or sign-up that did not hand Better Auth a
 * `callbackURL` (credential sign-in, credential sign-up, passkey): wait for
 * the session cookie to settle, count the conversion only if a session
 * exists, then navigate to the destination, unless the OAuth provider has
 * already answered with one.
 *
 * The navigation is a full document load, not `router.replace`. The Next
 * client router cache still holds the pre-login middleware result for the
 * destination (anonymous `/` -> `/signin`), so a soft nav bounces straight
 * back to the sign-in form. A full load re-runs middleware with the new
 * session cookie. `replace` keeps `/signin` off the history stack. This
 * lands directly on the app, not the marketing `/auth/callback` page, so no
 * hero swap or interstitial. Same pattern as the workspace-gate leave in
 * identity-onboarding-form.client.tsx. Social and magic-link cannot use this
 * — the provider round trip lands on `/auth/callback/signin` instead.
 */
export async function finishAuthInPlace({
  eventType,
  provider,
  returnUrl,
  result,
}: FinishAuthInPlaceOptions): Promise<void> {
  const session = await waitForAuthSession({
    context: eventType === "signUp" ? "signup" : "login",
    getSession: createAuthSessionGetter(() => authClient.getSession()),
    logWarning: (message) => {
      Sentry.captureMessage(message, { level: "warning" });
    },
  });

  if (session) {
    switch (eventType) {
      case "signUp":
        fireGTMEvent.signUp(provider);
        break;
      case "signIn":
        fireGTMEvent.signIn(provider);
        break;
    }
  }
  // Navigate once. A second navigation would deliver the authorization code
  // twice, and Core revokes a confidential client's tokens for that.
  if (isOAuthProviderRedirect(result)) {
    return;
  }
  window.location.replace(normalizeAuthReturnUrl(returnUrl));
}
