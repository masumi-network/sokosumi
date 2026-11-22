"use client";

import { isUrlString } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import type { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";

import { useEventListener } from "@/hooks/effects/use-event-listener";
import { authClient } from "@/lib/auth/auth.client";
import { buildSocialCallbackUrls } from "@/lib/auth/auth.utils";
import type { SocialProviderId } from "@/lib/schemas/auth";

export type SocialSignupMessageKey = "Google" | "Microsoft";

interface UseSocialSignupAutoInitiatorOptions {
  provider: SocialProviderId;
  messageKey: SocialSignupMessageKey;
  effectiveReturnUrl: string | undefined;
  t: ReturnType<typeof useTranslations<"Auth.Pages.SignUp">>;
}

/**
 * Automatically starts the direct social sign-up OAuth flow on mount, tracks
 * error/loading state, and reveals the retry action if restored from bfcache.
 */
export function useSocialSignupAutoInitiator({
  provider,
  messageKey,
  effectiveReturnUrl,
  t,
}: UseSocialSignupAutoInitiatorOptions) {
  const [error, setError] = useState<string | null>(null);
  const [isInitiating, setIsInitiating] = useState(true);
  const getFallbackErrorMessage = useEffectEvent(() =>
    t(`${messageKey}.error`),
  );

  useEffect(() => {
    const initiateOAuth = async () => {
      try {
        track("Sign Up", { provider, direct_signup_link: true });

        const result = await authClient.signIn.social({
          provider,
          // An error back on this page would start the sign-in again; /signup
          // explains it and offers every method.
          ...buildSocialCallbackUrls(provider, effectiveReturnUrl, "/signup"),
          // Leave with `replace`, so Back from the provider skips this page
          // instead of starting the sign-in again.
          disableRedirect: true,
        });

        // The client checks the scheme before its own redirect; keep that.
        const providerUrl = result.data?.url;
        if (isUrlString(providerUrl)) {
          window.location.replace(providerUrl);
        } else {
          const errorMessage =
            result.error?.message ?? getFallbackErrorMessage();
          setError(errorMessage);
          toast.error(errorMessage);
          setIsInitiating(false);
        }
      } catch {
        const errorMessage = getFallbackErrorMessage();
        setError(errorMessage);
        toast.error(errorMessage);
        setIsInitiating(false);
      }
    };

    initiateOAuth();
  }, [provider, effectiveReturnUrl]);

  // A page restored from the back/forward cache does not run the effect
  // again; offer the retry instead of a spinner with nothing behind it.
  useEventListener("window", "pageshow", (event) => {
    if (event.persisted) setIsInitiating(false);
  });

  const handleRetry = () => {
    setError(null);
    setIsInitiating(true);
    window.location.reload();
  };

  return { error, isInitiating, handleRetry };
}
