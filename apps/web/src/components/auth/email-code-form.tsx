"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Button } from "@/components/ui/button";

import {
  EMAIL_CODE_LENGTH,
  type EmailCodeError,
  EmailCodeField,
  useEmailCodeRefusal,
} from "./email-code-field";

interface EmailCodeFormProps {
  /** Where the code went. */
  email: string;
  /** Names what the code does here, e.g. "Confirm with code". */
  submitLabel: string;
  /** Resolves with Better Auth's error, or nothing once the code worked. */
  onSubmitCode: (code: string) => Promise<EmailCodeError | undefined>;
  /** When the current code went out, in epoch milliseconds. */
  sentAt: number;
  onResend: () => void;
  isResending: boolean;
}

/**
 * The second half of an email code on its own: the field and the button that
 * spends the code. Re-authentication types it into the tab that asked for it,
 * so the gated action there carries on.
 */
export function EmailCodeForm({
  email,
  submitLabel,
  onSubmitCode,
  sentAt,
  onResend,
  isResending,
}: EmailCodeFormProps) {
  const t = useTranslations("Components.EmailCodeForm");
  const fieldRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);
  const isLocked = isVerifying || isAccepted;
  const refusal = useEmailCodeRefusal({
    clear: () => setCode(""),
    focus: () => fieldRef.current?.focus(),
    isLocked,
  });

  function showError(message: string) {
    // The field is disabled while a code is checked; enable it first, so
    // focus can return to it. Moving there is what reads the error out.
    flushSync(() => {
      setError(message);
      setIsVerifying(false);
    });
    fieldRef.current?.focus();
  }

  // The button and a completed field both end here, so a code is spent one
  // way only. The field hands its code over before the state holding it has
  // rendered.
  const submitCode = async (submitted: string) => {
    if (submitting.current) return;
    if (submitted.length !== EMAIL_CODE_LENGTH) {
      showError(t("incomplete"));
      return;
    }

    submitting.current = true;
    setError(null);
    setIsVerifying(true);
    let accepted = false;
    try {
      const answer = await onSubmitCode(submitted);
      if (answer) {
        setError(refusal.refuse(answer));
        return;
      }
      // The page is leaving or the dialog is closing; a second submit would
      // spend a code that already worked.
      accepted = true;
      setIsAccepted(true);
    } catch {
      showError(t("generic"));
    } finally {
      submitting.current = accepted;
      setIsVerifying(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitCode(code);
  };

  return (
    <form noValidate className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <EmailCodeField
        inputRef={fieldRef}
        // Focus follows the step that just appeared.
        autoFocus
        value={code}
        completedCodeRef={refusal.completedCodeRef}
        onChange={(next) => {
          setCode(next);
          setError(null);
        }}
        onComplete={(completed) => {
          if (!isLocked) void submitCode(completed);
        }}
        email={email}
        error={error ?? undefined}
        sentAt={sentAt}
        onResend={onResend}
        isResending={isResending || isLocked}
        disabled={isLocked}
      />
      <Button type="submit" loading={isLocked}>
        {submitLabel}
      </Button>
    </form>
  );
}
