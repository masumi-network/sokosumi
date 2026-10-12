"use client";

import { isUrlString } from "@sokosumi/utils";
import { track } from "@vercel/analytics";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";
import {
  buildSocialCallbackUrls,
  readAuthReturnUrl,
} from "@/lib/auth/auth.utils";
import type { SocialProviderId } from "@/lib/schemas/auth";

/** Each provider's messages under `Auth.Pages.SignUp`. */
const MESSAGE_KEYS = {
  google: "Google",
  microsoft: "Microsoft",
} as const satisfies Record<SocialProviderId, string>;

interface SocialSignupAutoInitiatorProps {
  provider: SocialProviderId;
}

export default function SocialSignupAutoInitiator({
  provider,
}: SocialSignupAutoInitiatorProps) {
  const t = useTranslations("Auth.Pages.SignUp");
  const messageKey = MESSAGE_KEYS[provider];
  const searchParams = useSearchParams();
  const effectiveReturnUrl = readAuthReturnUrl(searchParams);
  const [error, setError] = useState<string | null>(null);
  const [isInitiating, setIsInitiating] = useState(true);

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
            result.error?.message ?? t(`${messageKey}.error`);
          setError(errorMessage);
          toast.error(errorMessage);
          setIsInitiating(false);
        }
      } catch {
        const errorMessage = t(`${messageKey}.error`);
        setError(errorMessage);
        toast.error(errorMessage);
        setIsInitiating(false);
      }
    };

    initiateOAuth();
  }, [provider, messageKey, effectiveReturnUrl, t]);

  // A page restored from the back/forward cache does not run the effect
  // again; offer the retry instead of a spinner with nothing behind it.
  useMountEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setIsInitiating(false);
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  });

  const handleRetry = () => {
    setError(null);
    setIsInitiating(true);
    window.location.reload();
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t(`${messageKey}.title`)}</h1>
          <p className="text-muted-foreground">
            {error ?? t(`${messageKey}.description`)}
          </p>
        </div>
        {isInitiating ? (
          <div className="flex justify-center">
            <div className="border-primary size-8 animate-spin motion-reduce:animate-pulse rounded-full border-4 border-t-transparent" />
          </div>
        ) : (
          <Button onClick={handleRetry} variant="primary" className="w-full">
            {t(`${messageKey}.retry`)}
          </Button>
        )}
      </div>
    </div>
  );
}
