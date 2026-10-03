"use client";

import { useTranslations } from "next-intl";

import { AUTH_STEP_LINK_CLASS } from "./auth-step-layout";
import type { EmailCode } from "./use-email-code";

interface EmailCodeSwitchProps {
  /** Confirmed on the email step. */
  email: string;
  emailCode: EmailCode;
  disabled?: boolean | undefined;
  onSwitchToCode: () => void;
}

/**
 * In Log in's password links row: the way to the emailed code. A code goes
 * out only when it is asked for here; one that already went out on Continue
 * still works, so the step switches back to it without another.
 */
export function EmailCodeSwitch({
  email,
  emailCode,
  disabled,
  onSwitchToCode,
}: EmailCodeSwitchProps) {
  const t = useTranslations("Auth.Email.Form");
  const wasCodeSent = emailCode.sentTo === email;

  return (
    <button
      type="button"
      className={AUTH_STEP_LINK_CLASS}
      disabled={disabled || emailCode.isSending}
      onClick={async () => {
        if (!wasCodeSent) await emailCode.sendCode(email);
        onSwitchToCode();
      }}
    >
      {wasCodeSent
        ? t("useCode")
        : emailCode.isSending
          ? t("emailCodeSending")
          : t("emailCode")}
    </button>
  );
}
