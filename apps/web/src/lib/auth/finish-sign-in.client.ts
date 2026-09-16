import * as Sentry from "@sentry/nextjs";

import { authClient } from "@/lib/auth/auth.client";
import {
  createAuthSessionGetter,
  normalizeAuthReturnUrl,
  waitForAuthSession,
} from "@/lib/auth/auth.utils";
import { fireGTMEvent } from "@/lib/gtm-events";
import type { AuthMethodId } from "@/lib/schemas/auth";

interface FinishSignInInPlaceOptions {
  provider: AuthMethodId;
  returnUrl: string | undefined;
}

/**
 * Completes a sign-in that did not hand Better Auth a `callbackURL`
 * (credential, passkey): wait for the session cookie to settle, count the
 * login only if a session exists, then navigate to the destination.
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
export async function finishSignInInPlace({
  provider,
  returnUrl,
}: FinishSignInInPlaceOptions): Promise<void> {
  const session = await waitForAuthSession({
    context: "login",
    getSession: createAuthSessionGetter(() => authClient.getSession()),
    logWarning: (message) => {
      Sentry.captureMessage(message, { level: "warning" });
    },
  });

  if (session) {
    fireGTMEvent.signIn(provider);
  }
  window.location.replace(normalizeAuthReturnUrl(returnUrl));
}
