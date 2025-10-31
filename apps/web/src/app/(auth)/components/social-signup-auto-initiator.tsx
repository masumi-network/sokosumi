"use client";

import { track } from "@vercel/analytics";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth.client";
import { fireGTMEvent } from "@/lib/gtm-events";
import { SocialProviderId } from "@/lib/schemas";

interface SocialSignupAutoInitiatorProps {
  provider: SocialProviderId;
  providerName: string;
}

export default function SocialSignupAutoInitiator({
  provider,
  providerName,
}: SocialSignupAutoInitiatorProps) {
  const t = useTranslations("Auth.Pages.SignUp");
  const [error, setError] = useState<string | null>(null);
  const [isInitiating, setIsInitiating] = useState(true);

  useEffect(() => {
    const initiateOAuth = async () => {
      try {
        track("Sign In", { provider, direct_signup_link: true });
        fireGTMEvent.ssoAuth(provider);

        const result = await authClient.signIn.social({
          provider,
          callbackURL: "/",
        });

        if (result.error) {
          const errorMessage =
            result.error.message ?? t(`${providerName}.error`);
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
  }, [provider, providerName, t]);

  const handleRetry = () => {
    setError(null);
    setIsInitiating(true);
    window.location.reload();
  };

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">
              {t(`${providerName}.title`)}
            </h1>
            <p className="text-muted-foreground">{error}</p>
          </div>
          <Button onClick={handleRetry} variant="primary" className="w-full">
            {t(`${providerName}.retry`)}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t(`${providerName}.title`)}
          </h1>
          <p className="text-muted-foreground">
            {t(`${providerName}.description`)}
          </p>
        </div>
        {isInitiating && (
          <div className="flex justify-center">
            <div className="border-primary size-8 animate-spin rounded-full border-4 border-t-transparent" />
          </div>
        )}
      </div>
    </div>
  );
}
