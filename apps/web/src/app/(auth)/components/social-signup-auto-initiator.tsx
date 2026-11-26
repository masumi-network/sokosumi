"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  type SocialSignupMessageKey,
  useSocialSignupAutoInitiator,
} from "@/hooks/effects/use-social-signup-auto-initiator";
import { readAuthReturnUrl } from "@/lib/auth/auth.utils";
import type { SocialProviderId } from "@/lib/schemas/auth";

/** Each provider's messages under `Auth.Pages.SignUp`. */
const MESSAGE_KEYS = {
  google: "Google",
  microsoft: "Microsoft",
} as const satisfies Record<SocialProviderId, SocialSignupMessageKey>;

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
  const { error, isInitiating, handleRetry } = useSocialSignupAutoInitiator({
    provider,
    messageKey,
    effectiveReturnUrl,
    t,
  });

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
            <div className="border-foreground size-8 animate-spin motion-reduce:animate-pulse rounded-full border-4 border-t-transparent" />
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
