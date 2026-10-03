"use client";

import { useTranslations } from "next-intl";

import type { EmailCode } from "./use-email-code";

/** A text button under a step, e.g. to switch the method. */
export const STEP_LINK_BUTTON_CLASS =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo rounded-sm text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed";

interface EmailCodeSwitchProps {
  /** Confirmed on the email step. */
  email: string;
  emailCode: EmailCode;
  onSwitchToCode: () => void;
}

/**
 * Under Log in's password step: the way to the emailed code. A code goes out
 * only when it is asked for here or already went out on Continue.
 */
export function EmailCodeSwitch({
  email,
  emailCode,
  onSwitchToCode,
}: EmailCodeSwitchProps) {
  const t = useTranslations("Auth.Email.Form");
  const wasCodeSent = emailCode.sentTo === email;

  // A div, not a p: the captcha widget may render inside it.
  return (
    <div className="text-muted-foreground text-center text-sm">
      {wasCodeSent ? (
        <>
          {t("codeStillWorks")}{" "}
          <button
            type="button"
            className={STEP_LINK_BUTTON_CLASS}
            onClick={onSwitchToCode}
          >
            {t("useCodeInstead")}
          </button>
        </>
      ) : (
        <>
          {emailCode.captcha}
          <button
            type="button"
            className={STEP_LINK_BUTTON_CLASS}
            disabled={emailCode.isSending}
            onClick={async () => {
              await emailCode.sendCode(email);
              onSwitchToCode();
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
