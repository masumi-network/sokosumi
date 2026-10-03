"use client";

import { useTranslations } from "next-intl";
import { type Ref, type RefObject, useId, useRef } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ResendCodeButton } from "./resend-code-button";

// Core's `otpLength`.
export const EMAIL_CODE_LENGTH = 6;

/** What Better Auth answers when it refuses a code. */
export interface EmailCodeError {
  code?: string;
  message?: string;
  status?: number;
}

/**
 * Says why Better Auth refused a code, in the page's language. Codes from
 * Better Auth's `EMAIL_OTP_ERROR_CODES`, and Core's terms check on every
 * `/sign-in*`. Their messages are English, so none is shown.
 */
export function useDescribeEmailCodeError() {
  const t = useTranslations("Components.EmailCodeForm");

  return (answer: EmailCodeError): string => {
    // Better Auth's rate limit (ten tries a minute per IP) can answer before the
    // code's own five tries run out; waiting helps, a new code does not.
    if (answer.status === 429) {
      return t("rateLimited");
    }
    switch (answer.code) {
      case "INVALID_OTP":
        return t("invalid");
      case "OTP_EXPIRED":
        return t("expired");
      case "TOO_MANY_ATTEMPTS":
        return t("tooManyAttempts");
      case "TERMS_NOT_ACCEPTED":
        return t("termsNotAccepted");
      default:
        return t("generic");
    }
  };
}

interface EmailCodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Called when the value becomes a whole code, typed, pasted or autofilled,
   * so the page can spend it without the button. Not again for the code it
   * last handed over, or the one the field opened on: sending that again,
   * refused or declined, is the button's. Without it, only the button sends.
   */
  onComplete?: (code: string) => void;
  /** Preserve completion history when a method switch remounts this field. */
  completedCodeRef?: RefObject<string>;
  onBlur?: () => void;
  /** Where the code went, when the page does not already show it. */
  email?: string | undefined;
  error?: string | undefined;
  sentAt: number;
  onResend: () => void;
  isResending: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * The field an emailed code goes into, with "Send a new code" beside its
 * label. Pasted codes arrive with spaces or dashes; only digits are kept.
 */
export function EmailCodeField({
  value,
  onChange,
  onComplete,
  completedCodeRef,
  onBlur,
  email,
  error,
  sentAt,
  onResend,
  isResending,
  disabled,
  autoFocus,
  inputRef,
}: EmailCodeFieldProps) {
  const t = useTranslations("Components.EmailCodeForm");
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const localCompletedCode = useRef(
    value.length === EMAIL_CODE_LENGTH ? value : "",
  );
  const completedCode = completedCodeRef ?? localCompletedCode;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Label htmlFor={fieldId}>{t("codeLabel")}</Label>
        <ResendCodeButton
          sentAt={sentAt}
          onResend={onResend}
          isSending={isResending || Boolean(disabled)}
        />
      </div>
      <Input
        ref={inputRef}
        id={fieldId}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        // The format, not a label: six digits.
        placeholder="000000"
        className="text-center font-mono tracking-[0.3em]"
        value={value}
        onChange={(event) => {
          const code = event.target.value
            .replace(/\D/g, "")
            .slice(0, EMAIL_CODE_LENGTH);
          onChange(code);
          if (
            onComplete &&
            code.length === EMAIL_CODE_LENGTH &&
            code !== completedCode.current
          ) {
            completedCode.current = code;
            onComplete(code);
          }
        }}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        disabled={disabled}
      />
      <p id={hintId} className="text-muted-foreground text-sm">
        {email ? t("sent", { email }) : t("sentNoAddress")}
      </p>
      {error ? (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
