"use client";

import { EMAIL_CODE_SIGN_IN_METHODS_REMOVED } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ACCOUNT_HREF } from "@/app/account/constants";
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
  /**
   * Core adds it to the new account once the code is accepted, so a password
   * account starts with its address proven. Core refuses it for an address
   * that already has an account, before the code is spent.
   */
  password?: string;
}

interface UseEmailCodeOptions {
  eventType: "signIn" | "signUp";
  returnUrl: string | undefined;
  /** Work that must be on its way before the page leaves. */
  beforeLeaving?: () => Promise<unknown>;
}

/**
 * A code sign-in that removed the account's password and provider links,
 * waiting for the person to read so before the page leaves.
 */
export interface RemovedSignInMethods {
  /** Leaves for where the sign-in was going, or to set a new password. */
  leave: (to: "returnUrl" | "setPassword") => void;
}

/**
 * Core sets it when the address was unproven: Better Auth then deletes the
 * password and the Google or Microsoft links (`revokeUnprovenAccountAccess`).
 */
function didRemoveSignInMethods(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    EMAIL_CODE_SIGN_IN_METHODS_REMOVED in data &&
    data[EMAIL_CODE_SIGN_IN_METHODS_REMOVED] === true
  );
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
  const [removed, setRemoved] = useState<RemovedSignInMethods | null>(null);

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

    const finish = (destination: string | undefined) =>
      finishAuthInPlace({
        eventType,
        // A password sign-up counts as one, whichever request carried it.
        provider: fields?.password === undefined ? "email-otp" : "credential",
        returnUrl: destination,
        result: result.data,
        beforeLeaving,
      });

    if (didRemoveSignInMethods(result.data)) {
      // Settles once the page is leaving, so the step stays locked.
      await new Promise<void>((resolve, reject) => {
        let leaving = false;
        setRemoved({
          leave: (to) => {
            if (leaving) return;
            leaving = true;
            finish(to === "setPassword" ? ACCOUNT_HREF : returnUrl).then(
              resolve,
              reject,
            );
          },
        });
      });
      return undefined;
    }

    await finish(returnUrl);
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
    removedSignInMethods: removed,
  };
}

export type EmailCode = ReturnType<typeof useEmailCode>;
