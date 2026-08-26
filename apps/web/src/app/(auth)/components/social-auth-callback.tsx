"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { authClient } from "@/lib/auth/auth.client";
import {
  createAuthSessionGetter,
  normalizeAuthReturnUrl,
  waitForAuthSession,
} from "@/lib/auth/auth.utils";
import { fireGTMEvent } from "@/lib/gtm-events";
import { authMethodIdSchema } from "@/lib/schemas/auth";

interface SocialAuthCallbackProps {
  eventType: "signUp" | "signIn";
}

export default function SocialAuthCallback({
  eventType,
}: SocialAuthCallbackProps) {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider");
    const returnUrl = params.get("returnUrl") ?? null;
    const validationResult = authMethodIdSchema.safeParse(provider);
    const redirectUrl = normalizeAuthReturnUrl(returnUrl ?? undefined);

    // Credential, social, and magic-link land here via a full page load
    // (Better Auth hard-redirects to `callbackURL` on success). Passkey
    // fires in place in social-buttons.tsx. The GTM event on this page
    // survives the hard nav — see apps/web/TRACKING.md.
    // The query string alone proves nothing: only count it when a session
    // actually exists, so a direct hit on this URL is not a fake login.
    // The first getSession() can be null (cookie still settling); reuse the
    // same retry/timeout helper as the other auth surfaces.
    void (async () => {
      if (validationResult.success) {
        const session = await waitForAuthSession({
          context: eventType === "signUp" ? "signup" : "login",
          getSession: createAuthSessionGetter(() => authClient.getSession()),
          logWarning: (message) => {
            Sentry.captureMessage(message, { level: "warning" });
          },
        }).catch(() => null);
        if (session) {
          switch (eventType) {
            case "signUp":
              fireGTMEvent.signUp(validationResult.data);
              break;
            case "signIn":
              fireGTMEvent.signIn(validationResult.data);
              break;
          }
        }
      }
      router.replace(redirectUrl);
    })();
  }, [router, eventType]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="border-primary size-8 animate-spin rounded-full border-4 border-t-transparent" />
    </div>
  );
}
