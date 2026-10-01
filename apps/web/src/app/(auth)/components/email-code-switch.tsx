"use client";

import { useTranslations } from "next-intl";

import type { EmailCode } from "./use-email-code";

const LINK_CLASS =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo rounded-sm text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed";

interface EmailCodeSwitchProps {
  /** Confirmed on the email step. */
  email: string;
  emailCode: EmailCode;
  isCodeStep: boolean;
  onSwitch: (method: "password" | "code") => void;
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
}: EmailCodeSwitchProps) {
  const t = useTranslations("Auth.Email.Form");
  const wasCodeSent = emailCode.sentTo === email;

  // A div, not a p: the captcha widget may render inside it.
  return (
    <div className="text-muted-foreground text-center text-sm">
      {isCodeStep ? (
        <button
          type="button"
          data-testid="auth-use-password"
          className={LINK_CLASS}
          onClick={() => onSwitch("password")}
        >
          {t("usePasswordInstead")}
        </button>
      ) : wasCodeSent ? (
        <>
          {t("codeStillWorks")}{" "}
          <button
            type="button"
            className={LINK_CLASS}
            onClick={() => onSwitch("code")}
          >
            {t("useCodeInstead")}
          </button>
        </>
      ) : (
        <>
          {emailCode.captcha}
          <button
            type="button"
            className={LINK_CLASS}
            disabled={emailCode.isSending}
            onClick={async () => {
              await emailCode.sendCode(email);
              onSwitch("code");
            }}
          >
            {emailCode.isSending
              ? t("emailCodeSending")
              : t("emailCodeInstead")}
          </button>
        </>
      )}
    </div>
  );
}
