"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import type { EmailCodeError } from "@/components/auth/email-code-field";
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
  const [sentAt, setSentAt] = useState(0);

  // Not counted as an attempt here: sign-up sends on Continue, before anyone
  // chose a code. The pages count the choice. Resolves to the send time, or
  // `null` when no code went out.
  async function sendCode(
    email: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<number | null> {
    setIsSending(true);
    let sentAt: number | null = null;

    try {
      await runWithCaptcha(async (fetchOptions) => {
        if (options.signal?.aborted) return;
        const result = await authClient.emailOtp.sendVerificationOtp({
          fetchOptions,
          email,
          type: "sign-in",
        });

        if (options.signal?.aborted) return;
        if (result.error) {
          toast.error(
            getErrorMessage(
              result.error,
              result.error.message ?? t("emailCodeError"),
            ),
          );
          return;
        }

        sentAt = Date.now();
        adoptSentCode(email, sentAt);
      });
    } catch (_error) {
      if (!options.signal?.aborted) toast.error(t("emailCodeError"));
    } finally {
      setIsSending(false);
    }
    return sentAt;
  }

  /** A code another page sent, e.g. sign-in before it handed over to sign-up. */
  function adoptSentCode(email: string, at: number) {
    setSentTo(email);
    setSentAt(at);
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

  return {
    captcha,
    isSending,
    sentTo,
    sentAt,
    sendCode,
    adoptSentCode,
    signInWithCode,
  };
}

export type EmailCode = ReturnType<typeof useEmailCode>;
