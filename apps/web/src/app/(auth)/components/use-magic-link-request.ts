"use client";

import { track } from "@vercel/analytics";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useAuthCaptcha } from "@/components/auth-captcha";
import { authClient } from "@/lib/auth/auth.client";
import {
  buildAuthCallbackUrl,
  buildAuthErrorCallbackUrl,
} from "@/lib/auth/auth.utils";

/**
 * Requests a Magic Link for an email the caller has already validated.
 * `sentTo` holds the address of the last link that went out, so the caller
 * can tell "sent" from "sent to an address the user has since edited".
 */
export function useMagicLinkRequest(returnUrl: string | undefined) {
  const t = useTranslations("Auth.SocialButtons");
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("magic-link");
  const [isRequesting, setIsRequesting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function requestMagicLink(email: string) {
    track("Sign In", { provider: "magic-link", direct_signup_link: false });
    setIsRequesting(true);

    try {
      // The link lands on the callback page (full page load), which fires the
      // `login` GTM event and then forwards to the return URL.
      await runWithCaptcha(async (fetchOptions) => {
        const result = await authClient.signIn.magicLink({
          fetchOptions,
          email,
          callbackURL: buildAuthCallbackUrl(
            "/auth/callback/signin",
            "magic-link",
            returnUrl,
          ),
          // An expired or used link returns here with `error`, not to the
          // callback page, which has no session and no message to show.
          errorCallbackURL: buildAuthErrorCallbackUrl(),
        });

        if (result.error) {
          toast.error(
            getErrorMessage(
              result.error,
              result.error.message ?? t("magicLinkError"),
            ),
          );
          return;
        }

        setSentTo(email);
      });
    } catch (_error) {
      toast.error(t("magicLinkError"));
    } finally {
      setIsRequesting(false);
    }
  }

  return { captcha, isRequesting, sentTo, requestMagicLink };
}
