"use client";

import { track } from "@vercel/analytics";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ComponentProps } from "react";
import {
  GoogleLoginButton,
  MicrosoftLoginButton,
} from "react-social-login-buttons";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { authClient } from "@/lib/auth/auth.client";
import { buildOAuthConsentReturnUrlFromSearchParams } from "@/lib/utils/auth-redirect";
import { buildAuthCallbackUrl } from "@/lib/utils/url";

export type SocialButtonProviderId = "google" | "microsoft";

interface SocialButtonsProps {
  returnUrl?: string;
  lastUsedSocialProvider?: SocialButtonProviderId | null;
}

const socialButtons: Array<{
  key: SocialButtonProviderId;
  name: string;
  Button: React.FC<ComponentProps<typeof GoogleLoginButton>>;
}> = [
  {
    key: "google",
    name: "Google",
    Button: GoogleLoginButton,
  },
  {
    key: "microsoft",
    name: "Microsoft",
    Button: MicrosoftLoginButton,
  },
];

export default function SocialButtons({
  returnUrl,
  lastUsedSocialProvider = null,
}: SocialButtonsProps = {}) {
  const t = useTranslations("Auth.SocialButtons");
  const searchParams = useSearchParams();
  const effectiveReturnUrl =
    returnUrl ?? buildOAuthConsentReturnUrlFromSearchParams(searchParams);

  const handleClick = async (key: SocialButtonProviderId) => {
    track("Sign In", { provider: key, direct_signup_link: false });

    const result = await authClient.signIn.social({
      provider: key,
      callbackURL: buildAuthCallbackUrl(
        "/auth/callback/signin",
        key,
        effectiveReturnUrl,
      ),
      newUserCallbackURL: buildAuthCallbackUrl(
        "/auth/callback/signup",
        key,
        effectiveReturnUrl,
      ),
    });
    if (result.error) {
      const errorMessage = result.error.message ?? t("error");
      toast.error(errorMessage);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {socialButtons.map((socialButton) => (
        <div className="relative" key={socialButton.key}>
          <socialButton.Button
            onClick={() => handleClick(socialButton.key)}
            className="bg-senary! hover:bg-quinary! text-foreground! m-0! flex w-full! rounded-md! px-4! py-2! text-sm! shadow-none! transition-colors! duration-300! [&>div]:justify-center! [&>div]:gap-2! [&>div_div]:w-auto!"
            align="center"
            text={t("continueWith", { provider: socialButton.name })}
          />
          {lastUsedSocialProvider === socialButton.key && (
            <Badge
              variant="secondary"
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
            >
              {t("lastUsed")}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}
