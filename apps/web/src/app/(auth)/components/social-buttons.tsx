"use client";

import { track } from "@vercel/analytics";
import { Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ComponentProps, FormEvent, useMemo, useState } from "react";
import {
  GoogleLoginButton,
  MicrosoftLoginButton,
} from "react-social-login-buttons";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestMagicLinkSignIn } from "@/lib/actions/auth";
import { authClient } from "@/lib/auth/auth.client";
import { emailSchema } from "@/lib/auth/data";
import { buildOAuthConsentReturnUrlFromSearchParams } from "@/lib/utils/auth-redirect";
import { buildAuthCallbackUrl } from "@/lib/utils/url";

export type SocialButtonProviderId = "google" | "microsoft";
export type SignInMethodId = SocialButtonProviderId | "magic-link";

interface SocialButtonsProps {
  returnUrl?: string;
  lastUsedMethod?: SignInMethodId | null;
  prefilledEmail?: string;
  showMagicLink?: boolean;
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
  lastUsedMethod = null,
  prefilledEmail,
  showMagicLink = false,
}: SocialButtonsProps = {}) {
  const t = useTranslations("Auth.SocialButtons");
  const searchParams = useSearchParams();
  const effectiveReturnUrl = useMemo(
    () => returnUrl ?? buildOAuthConsentReturnUrlFromSearchParams(searchParams),
    [returnUrl, searchParams],
  );
  const [magicLinkEmail, setMagicLinkEmail] = useState(prefilledEmail ?? "");
  const [isMagicLinkVisible, setIsMagicLinkVisible] = useState(false);
  const [isRequestingMagicLink, setIsRequestingMagicLink] = useState(false);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);
  const hasMagicLinkSuccess =
    magicLinkEmail.trim().length > 0 &&
    magicLinkEmail.trim() === magicLinkSentTo;

  const handleMagicLinkSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedEmail = magicLinkEmail.trim();
    if (!emailSchema().safeParse(trimmedEmail).success) {
      toast.error(t("magicLinkInvalidEmail"));
      return;
    }

    track("Sign In", { provider: "magic-link", direct_signup_link: false });
    setIsRequestingMagicLink(true);

    try {
      const result = await requestMagicLinkSignIn(
        trimmedEmail,
        effectiveReturnUrl,
      );

      if (!result.ok) {
        toast.error(result.error?.message ?? t("magicLinkError"));
        return;
      }

      setMagicLinkSentTo(trimmedEmail);
    } catch (_error) {
      toast.error(t("magicLinkError"));
    } finally {
      setIsRequestingMagicLink(false);
    }
  };

  const handleMagicLinkClick = () => {
    setIsMagicLinkVisible((currentValue) => !currentValue);
  };

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
          {lastUsedMethod === socialButton.key && (
            <Badge
              variant="secondary"
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
            >
              {t("lastUsed")}
            </Badge>
          )}
        </div>
      ))}
      {showMagicLink && (
        <div className="relative">
          <Button
            type="button"
            variant="secondary"
            className="bg-senary hover:bg-quinary text-foreground h-[50px] w-full justify-center gap-2 rounded-md border-0 px-4 py-2 text-sm font-normal shadow-none"
            onClick={handleMagicLinkClick}
          >
            <Mail className="size-4" />
            {t("magicLinkButton")}
          </Button>
          {lastUsedMethod === "magic-link" && (
            <Badge
              variant="secondary"
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
            >
              {t("lastUsed")}
            </Badge>
          )}
        </div>
      )}
      {showMagicLink && isMagicLinkVisible && (
        <form
          className="bg-muted/30 flex flex-col gap-2 rounded-md border p-4"
          onSubmit={handleMagicLinkSubmit}
        >
          {hasMagicLinkSuccess && (
            <p className="text-muted-foreground text-center text-sm">
              {t("magicLinkSuccess")}
            </p>
          )}
          <Input
            type="email"
            className="text-center placeholder:text-center"
            value={magicLinkEmail}
            onChange={(event) => {
              setMagicLinkEmail(event.target.value);
            }}
            placeholder={t("magicLinkPlaceholder")}
            aria-label={t("magicLinkInputLabel")}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={isRequestingMagicLink}
          >
            {isRequestingMagicLink
              ? t("magicLinkSubmitting")
              : hasMagicLinkSuccess
                ? t("magicLinkResend")
                : t("magicLinkSubmit")}
          </Button>
        </form>
      )}
    </div>
  );
}
