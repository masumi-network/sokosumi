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
}

/**
 * Completes a sign-in or sign-up that did not hand Better Auth a
 * `callbackURL` (credential sign-in, credential sign-up, passkey): wait for
 * the session cookie to settle, count the conversion only if a session
 * exists, then navigate to the destination.
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
  window.location.replace(normalizeAuthReturnUrl(returnUrl));
}
