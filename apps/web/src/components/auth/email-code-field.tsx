"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useTranslations } from "next-intl";
import { type Ref, type RefObject, useEffect, useId, useRef } from "react";
import * as z from "zod";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { ResendCodeButton } from "./resend-code-button";

// Core's `otpLength`.
export const EMAIL_CODE_LENGTH = 6;

/** A form's code: whole, or it says the code is incomplete. */
export function useEmailCodeSchema() {
  const t = useTranslations("Components.EmailCodeForm");
  return z.string().length(EMAIL_CODE_LENGTH, { message: t("incomplete") });
}

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
 * Better Auth's `EMAIL_OTP_ERROR_CODES`; their messages are English, so none
 * is shown.
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

interface EmailCodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Called when the value becomes a whole code, typed, pasted or autofilled,
   * so the page can spend it without the button. Not again for the code it
   * last handed over, or the one the field opened on: sending that again is
   * the button's, until `useEmailCodeRefusal` clears a refused one. Without
   * it, only the button sends.
   */
  onComplete?: (code: string) => void;
  /**
   * Preserve completion history when a method switch remounts this field;
   * `useEmailCodeRefusal` gives one.
   */
  completedCodeRef?: RefObject<string>;
  onBlur?: () => void;
  /** Where the code went, when the page does not already show it. */
  email?: string | undefined;
  error?: string | undefined;
  /** Why the field opened, shown above it and read with it. */
  notice?: string | undefined;
  /**
   * No code went out: the field says so instead of saying one did, until
   * `error` gives another reason.
   */
  unsent?: boolean | undefined;
  sentAt: number;
  onResend: () => void;
  isResending: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /**
   * Centers the field's lines on the auth pages, with "Send a new code"
   * under the label instead of beside it.
   */
  centered?: boolean;
}

/**
 * The field an emailed code goes into, one slot per digit, with "Send a new
 * code" beside its label, or under it when `centered`. Only digits go in.
 */
export function EmailCodeField({
  value,
  onChange,
  onComplete,
  completedCodeRef,
  onBlur,
  email,
  error,
  notice,
  unsent = false,
  sentAt,
  onResend,
  isResending,
  disabled,
  autoFocus,
  inputRef,
  centered = false,
}: EmailCodeFieldProps) {
  const t = useTranslations("Components.EmailCodeForm");
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const shownError = error ?? (unsent ? t("notSent") : undefined);
  const noticeId = useId();
  const localCompletedCode = useRef(
    value.length === EMAIL_CODE_LENGTH ? value : "",
  );
  const completedCode = completedCodeRef ?? localCompletedCode;

  return (
    <div className={cn("grid gap-2", centered && "text-center")}>
      {notice ? (
        // The grid's gap and this margin match the form's gap.
        <p id={noticeId} className="text-muted-foreground mb-1 text-sm">
          {notice}
        </p>
      ) : null}
      <div
        className={cn(
          "flex gap-x-4 gap-y-1",
          centered
            ? "flex-col items-center"
            : "flex-wrap items-center justify-between",
        )}
      >
        <Label htmlFor={fieldId}>{t("codeLabel")}</Label>
        <ResendCodeButton
          sentAt={sentAt}
          onResend={onResend}
          isSending={isResending || Boolean(disabled)}
        />
      </div>
      <InputOTP
        ref={inputRef}
        id={fieldId}
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
        aria-invalid={shownError ? true : undefined}
        aria-describedby={
          [
            notice ? noticeId : null,
            unsent ? null : hintId,
            shownError ? errorId : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        disabled={disabled}
      >
        <InputOTPGroup>
          {CODE_SLOTS.map((index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {/* Without an address the page shows it above the field, and the slots
          show the length, so the line only tells a screen reader a code went
          out. */}
      {unsent ? null : (
        <p
          id={hintId}
          className={email ? "text-muted-foreground text-sm" : "sr-only"}
        >
          {email ? t("sent", { email }) : t("sentNoAddress")}
        </p>
      )}
      {shownError ? (
        <p id={errorId} className="text-destructive text-sm">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
