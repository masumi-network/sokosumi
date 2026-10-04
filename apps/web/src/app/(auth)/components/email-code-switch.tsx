"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

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
  /** The way to a new password, before the switch in the same row. */
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
  forgotPassword,
}: EmailCodeSwitchProps) {
  const t = useTranslations("Auth.Email.Form");
  const wasCodeSent = emailCode.sentTo === email;

  const willSend = !isCodeStep && !wasCodeSent;
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
        await emailCode.sendCode(email);
        onSwitch("code");
      }}
    >
      {emailCode.isSending ? t("emailCodeSending") : t("emailCodeInstead")}
    </button>
  );

  // A div, not a p: the captcha widget may render inside it.
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 text-center text-sm">
      {willSend ? emailCode.captcha : null}
      {/* One row from the sm breakpoint; stacked on a phone, where the row
          would wrap and leave the dot hanging. */}
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
        {forgotPassword ? (
          <>
            {forgotPassword}
            <span aria-hidden className="hidden sm:inline">
              ·
            </span>
          </>
        ) : null}
        {action}
      </div>
    </div>
  );
}
