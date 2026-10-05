"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { RunWithCaptcha } from "@/components/auth-captcha";

import type { EmailCode } from "./use-email-code";

/** A text button under the second step, e.g. to switch the method. */
export const STEP_LINK_BUTTON_CLASS =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo rounded-sm text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed";

interface EmailCodeSwitchProps {
  /** Confirmed on the email step. */
  email: string;
  emailCode: EmailCode;
  isCodeStep: boolean;
  onSwitch: (method: "password" | "code") => void;
  /**
   * The password step's check, for a code asked for here. One widget on the
   * step, so a visitor Cloudflare wants to see is not asked twice.
   */
  runWithCaptcha: RunWithCaptcha;
  /** The way to a new password, above the switch. */
  forgotPassword?: ReactNode;
}

/**
 * Under the second step of sign-in and sign-up: the way from the emailed code
 * to a password and back. A code goes out only when it is asked for here or
 * already went out on Continue.
 */
export function EmailCodeSwitch({
  email,
  emailCode,
  isCodeStep,
  onSwitch,
  runWithCaptcha,
  forgotPassword,
}: EmailCodeSwitchProps) {
  const t = useTranslations("Auth.Email.Form");
  const wasCodeSent = emailCode.sentTo === email;

  const action = isCodeStep ? (
    <button
      type="button"
      data-testid="auth-use-password"
      className={STEP_LINK_BUTTON_CLASS}
      onClick={() => onSwitch("password")}
    >
      {t("usePasswordInstead")}
    </button>
  ) : wasCodeSent ? (
    <span>
      {t("codeStillWorks")}{" "}
      <button
        type="button"
        className={STEP_LINK_BUTTON_CLASS}
        onClick={() => onSwitch("code")}
      >
        {t("useCodeInstead")}
      </button>
    </span>
  ) : (
    <button
      type="button"
      className={STEP_LINK_BUTTON_CLASS}
      disabled={emailCode.isSending}
      onClick={async () => {
        await emailCode.sendCode(email, { runWithCaptcha });
        onSwitch("code");
      }}
    >
      {emailCode.isSending ? t("emailCodeSending") : t("emailCodeInstead")}
    </button>
  );

  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 text-center text-sm">
      {/* One row on wider screens; a link that does not fit (German, Spanish,
          or the longer "code still works" line) wraps whole onto its own row. */}
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-3">
        {forgotPassword}
        {action}
      </div>
    </div>
  );
}
