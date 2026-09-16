import * as Sentry from "@sentry/nextjs";
import type { useRouter } from "next/navigation";

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
  router: Pick<ReturnType<typeof useRouter>, "replace">;
}

/**
 * Completes a sign-in that did not hand Better Auth a `callbackURL`
 * (credential, passkey): wait for the session cookie to settle, count the
 * login only if a session exists, then soft-navigate so the auth shell is
 * never re-rendered mid-login. Social and magic-link cannot use this — the
 * provider round trip lands on `/auth/callback/signin` instead.
 */
export async function finishSignInInPlace({
  provider,
  returnUrl,
  router,
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
  router.replace(normalizeAuthReturnUrl(returnUrl));
}
