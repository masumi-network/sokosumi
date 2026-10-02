"use client";

import { track } from "@vercel/analytics";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";
import {
  buildAuthCallbackUrl,
  buildAuthErrorCallbackUrl,
  buildOAuthResumeUrlFromSearchParams,
} from "@/lib/auth/auth.utils";
import type { SocialProviderId } from "@/lib/schemas/auth";

interface SocialSignupAutoInitiatorProps {
  provider: SocialProviderId;
  providerName: string;
}

export default function SocialSignupAutoInitiator({
  provider,
  providerName,
}: SocialSignupAutoInitiatorProps) {
  const t = useTranslations("Auth.Pages.SignUp");
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") ?? undefined;
  const effectiveReturnUrl =
    returnUrl ?? buildOAuthResumeUrlFromSearchParams(searchParams);
  const [error, setError] = useState<string | null>(null);
  const [isInitiating, setIsInitiating] = useState(true);

  useEffect(() => {
    const initiateOAuth = async () => {
      try {
        track("Sign Up", { provider, direct_signup_link: true });

        const result = await authClient.signIn.social({
          provider,
          callbackURL: buildAuthCallbackUrl(
            "/auth/callback/signin",
            provider,
            effectiveReturnUrl,
          ),
          newUserCallbackURL: buildAuthCallbackUrl(
            "/auth/callback/signup",
            provider,
            effectiveReturnUrl,
          ),
          // Back to this page would start the sign-in again; /signup
          // explains the error and offers every method.
          errorCallbackURL: buildAuthErrorCallbackUrl("/signup"),
          // Leave with `replace`, so Back from the provider skips this page
          // instead of starting the sign-in again.
          disableRedirect: true,
        });

        if (result.data?.url) {
          window.location.replace(result.data.url);
        } else {
          const errorMessage =
            result.error?.message ?? t(`${providerName}.error`);
          setError(errorMessage);
          toast.error(errorMessage);
          setIsInitiating(false);
        }
      } catch {
        const errorMessage = t(`${providerName}.error`);
        setError(errorMessage);
        toast.error(errorMessage);
        setIsInitiating(false);
      }
    };

    initiateOAuth();
  }, [provider, providerName, effectiveReturnUrl, t]);

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

  const retryButton = (
    <Button onClick={handleRetry} variant="primary" className="w-full">
      {t(`${providerName}.retry`)}
    </Button>
  );

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">
              {t(`${providerName}.title`)}
            </h1>
            <p className="text-muted-foreground">{error}</p>
          </div>
          {retryButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t(`${providerName}.title`)}
          </h1>
          <p className="text-muted-foreground">
            {t(`${providerName}.description`)}
          </p>
        </div>
        {isInitiating ? (
          <div className="flex justify-center">
            <div className="border-primary size-8 animate-spin motion-reduce:animate-pulse rounded-full border-4 border-t-transparent" />
          </div>
        ) : (
          retryButton
        )}
      </div>
    </div>
  );
}
