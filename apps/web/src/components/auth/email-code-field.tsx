"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useTranslations } from "next-intl";
import { type Ref, type RefObject, useEffect, useId, useRef } from "react";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";

import { ResendCodeButton } from "./resend-code-button";

// Core's `otpLength`.
export const EMAIL_CODE_LENGTH = 6;

const CODE_SLOTS = Array.from(
  { length: EMAIL_CODE_LENGTH },
  (_, index) => index,
);

/** Pasted codes arrive with spaces or dashes; only digits are kept. */
function keepDigits(pasted: string): string {
  return pasted.replace(/\D/g, "");
}

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
function useDescribeEmailCodeError() {
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

interface EmailCodeRefusalOptions {
  /** Empties the field's value, leaving its error as it is. */
  clear: () => void;
  focus: () => void;
  /** While the code is checked; focus waits until the field is enabled. */
  isLocked: boolean;
}

/**
 * What a page does when Better Auth refuses a code. The field holds six
 * digits at most, so the refused ones are cleared for the next code, and the
 * same code typed again is handed over again. Focus returns to the field, which
 * reads the reason out; the page keeps it until the person types.
 */
export function useEmailCodeRefusal({
  clear,
  focus,
  isLocked,
}: EmailCodeRefusalOptions) {
  const describe = useDescribeEmailCodeError();
  // Pass to the field, so its handed-over code survives a remount.
  const completedCodeRef = useRef("");
  const focusPending = useRef(false);

  // Runs after every render, and focuses once per refusal when unlocked.
  useEffect(() => {
    if (!focusPending.current || isLocked) return;
    focusPending.current = false;
    focus();
  });

  /** Clears the field and returns the reason to show beside it. */
  const refuse = (answer: EmailCodeError): string => {
    completedCodeRef.current = "";
    focusPending.current = true;
    clear();
    return describe(answer);
  };

  return { completedCodeRef, refuse };
}

interface EmailCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Called when the value becomes a whole code, typed, pasted or autofilled,
   * so the page can spend it without a button. Not again for the code it
   * last handed over, or the one the field opened on: sending that again
   * waits until `useEmailCodeRefusal` clears a refused one.
   */
  onComplete?: (code: string) => void;
  /**
   * Preserve completion history when a method switch remounts this field;
   * `useEmailCodeRefusal` gives one.
   */
  completedCodeRef?: RefObject<string>;
  onBlur?: () => void;
  /** The page refused the code, or asked for the rest of it. */
  invalid?: boolean | undefined;
  /** Ids of the page's lines that explain the field, in reading order. */
  describedBy?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  inputRef?: Ref<HTMLInputElement>;
  id?: string | undefined;
  /** Underlined on the auth pages (ADR 0051); boxed under a visible label. */
  variant?: "boxed" | "underlined" | undefined;
}

/**
 * The slots an emailed code goes into, one per digit. Only digits go in. It
 * keeps its accessible name without a visible label; the page says where the
 * code went and why it was refused.
 */
export function EmailCodeInput({
  value,
  onChange,
  onComplete,
  completedCodeRef,
  onBlur,
  invalid,
  describedBy,
  disabled,
  autoFocus,
  inputRef,
  id,
  variant = "underlined",
}: EmailCodeInputProps) {
  const t = useTranslations("Components.EmailCodeForm");
  const localCompletedCode = useRef(
    value.length === EMAIL_CODE_LENGTH ? value : "",
  );
  const completedCode = completedCodeRef ?? localCompletedCode;

  return (
    <InputOTP
      ref={inputRef}
      id={id}
      variant={variant}
      aria-label={t("codeLabel")}
      maxLength={EMAIL_CODE_LENGTH}
      pattern={REGEXP_ONLY_DIGITS}
      pasteTransformer={keepDigits}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      value={value}
      onChange={(code) => {
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
      onPasteCapture={(event) => {
        // InputOTP pastes at the caret, which sits on the last slot of a
        // full field; a whole code replaces what is there instead.
        const pasted = keepDigits(event.clipboardData.getData("text/plain"));
        if (pasted.length >= EMAIL_CODE_LENGTH) {
          event.currentTarget.setSelectionRange(0, value.length);
        }
      }}
      onBlur={onBlur}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy || undefined}
      disabled={disabled}
    >
      <InputOTPGroup>
        {CODE_SLOTS.map((index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

interface EmailCodeFieldProps
  extends Pick<
    EmailCodeInputProps,
    | "value"
    | "onChange"
    | "onComplete"
    | "completedCodeRef"
    | "onBlur"
    | "disabled"
    | "autoFocus"
    | "inputRef"
  > {
  /** Where the code went, when the page does not already show it. */
  email?: string | undefined;
  error?: string | undefined;
  sentAt: number;
  onResend: () => void;
  isResending: boolean;
}

/**
 * The code slots under a visible label, with "Send a new code" beside it and
 * where the code went under it, for forms not yet on the auth step layout.
 */
export function EmailCodeField({
  email,
  error,
  sentAt,
  onResend,
  isResending,
  disabled,
  ...input
}: EmailCodeFieldProps) {
  const t = useTranslations("Components.EmailCodeForm");
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();

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
      <EmailCodeInput
        {...input}
        id={fieldId}
        variant="boxed"
        invalid={Boolean(error)}
        describedBy={[hintId, error ? errorId : null].filter(Boolean).join(" ")}
        disabled={disabled}
      />
      {/* Without an address the page shows it above the field, and the slots
          show the length, so the line only tells a screen reader a code went
          out. */}
      <p
        id={hintId}
        className={email ? "text-muted-foreground text-sm" : "sr-only"}
      >
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
