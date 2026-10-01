"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Core's `otpLength`.
const CODE_LENGTH = 6;

/** What Better Auth answers when it refuses a code. */
export interface EmailCodeError {
  code?: string;
  message?: string;
  status?: number;
}

interface EmailCodeFormProps {
  /** Where the code went. */
  email: string;
  /** Names what the code does here: sign in, create the account, confirm. */
  submitLabel: string;
  /**
   * Resolves with Better Auth's error, nothing once the code worked, or
   * `false` when the page did not send the code and marked what to fix
   * itself.
   */
  onSubmitCode: (code: string) => Promise<EmailCodeError | false | undefined>;
  onResend: () => void;
  isResending: boolean;
}

/**
 * The second half of an email code: the field the code goes into. The code is
 * typed into the tab that asked for it, so whatever that tab was doing (a
 * sign-in for another app, a gated action) carries on.
 */
export function EmailCodeForm({
  email,
  submitLabel,
  onSubmitCode,
  onResend,
  isResending,
}: EmailCodeFormProps) {
  const t = useTranslations("Components.EmailCodeForm");
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);

  // Codes from Better Auth's `EMAIL_OTP_ERROR_CODES`, and Core's terms check
  // on every `/sign-in*`. Their messages are English, so none is shown.
  function describeError(answer: EmailCodeError): string {
    // Better Auth's rate limit (three tries a minute) can answer before the
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
  }

  function showError(message: string) {
    setError(message);
    // Submitting left focus on the button; send it back to the field.
    fieldRef.current?.focus();
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) {
      showError(t("incomplete"));
      return;
    }

    setError(null);
    setIsVerifying(true);
    try {
      const answer = await onSubmitCode(code);
      if (answer === false) {
        return;
      }
      if (answer) {
        showError(describeError(answer));
        return;
      }
      // The page is leaving or the dialog is closing; a second submit would
      // spend a code that already worked.
      setIsAccepted(true);
    } catch {
      showError(t("generic"));
    } finally {
      setIsVerifying(false);
    }
  };

  const isLocked = isVerifying || isAccepted;

  return (
    <form noValidate className="flex flex-col gap-2" onSubmit={handleSubmit}>
      {/* Read out with the field, which takes focus when this appears. */}
      <p id={hintId} className="text-muted-foreground text-sm">
        {t("sent", { email })}
      </p>
      <Label htmlFor={fieldId}>{t("codeLabel")}</Label>
      <Input
        ref={fieldRef}
        id={fieldId}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        className="text-center font-mono tracking-[0.3em]"
        value={code}
        onChange={(event) => {
          // Pasted codes arrive with spaces or dashes; only digits count.
          setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        disabled={isAccepted}
      />
      {error ? (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={isLocked}>
        {isLocked ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
        ) : null}
        {submitLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={isResending || isLocked}
        onClick={onResend}
      >
        {t("resend")}
      </Button>
    </form>
  );
}
