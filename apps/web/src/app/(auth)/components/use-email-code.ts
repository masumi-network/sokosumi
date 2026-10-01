"use client";

import { track } from "@vercel/analytics";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import type { EmailCodeError } from "@/components/auth/email-code-form";
import { useAuthCaptcha } from "@/components/auth-captcha";
import { authClient } from "@/lib/auth/auth.client";
import { finishAuthInPlace } from "@/lib/auth/finish-auth.client";

/** Sent with the code from the sign-up page, so the new account has a name. */
export interface EmailCodeSignUpFields {
  firstName: string;
  lastName: string;
  marketingOptIn: boolean;
  termsAccepted: true;
}

interface UseEmailCodeOptions {
  eventType: "signIn" | "signUp";
  returnUrl: string | undefined;
  /** Work that must be on its way before the page leaves. */
  beforeLeaving?: () => Promise<unknown>;
}

/**
 * Emails a sign-in code and signs in with it. The code comes back to this
 * tab, so a sign-in for another app keeps that app's request: the OAuth
 * client plugin sends the signed query with the sign-in, and Core answers
 * with the way back.
 */
export function useEmailCode({
  eventType,
  returnUrl,
  beforeLeaving,
}: UseEmailCodeOptions) {
  const t = useTranslations("Auth.SocialButtons");
  const {
    widget: captcha,
    runWithCaptcha,
    getErrorMessage,
  } = useAuthCaptcha("email-code");
  const [isSending, setIsSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function sendCode(email: string) {
    track(eventType === "signUp" ? "Sign Up" : "Sign In", {
      provider: "email-otp",
      direct_signup_link: false,
    });
    setIsSending(true);

    try {
      await runWithCaptcha(async (fetchOptions) => {
        const result = await authClient.emailOtp.sendVerificationOtp({
          fetchOptions,
          email,
          type: "sign-in",
        });

        if (result.error) {
          toast.error(
            getErrorMessage(
              result.error,
              result.error.message ?? t("emailCodeError"),
            ),
          );
          return;
        }

        setSentTo(email);
      });
    } catch (_error) {
      toast.error(t("emailCodeError"));
    } finally {
      setIsSending(false);
    }
  }

  async function signInWithCode(
    email: string,
    otp: string,
    fields?: EmailCodeSignUpFields,
  ): Promise<EmailCodeError | undefined> {
    const result = await authClient.signIn.emailOtp({ email, otp, ...fields });
    if (result.error) {
      return result.error;
    }

    await finishAuthInPlace({
      eventType,
      provider: "email-otp",
      returnUrl,
      result: result.data,
      beforeLeaving,
    });
    return undefined;
  }

  return { captcha, isSending, sentTo, sendCode, signInWithCode };
}
