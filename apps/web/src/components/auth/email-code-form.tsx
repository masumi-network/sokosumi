"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import {
  EMAIL_CODE_LENGTH,
  type EmailCodeError,
  EmailCodeField,
  useDescribeEmailCodeError,
} from "./email-code-field";

interface EmailCodeFormProps {
  /** Where the code went, when the page does not already show it. */
  email?: string | undefined;
  /** Names what the code does here: sign in, confirm. */
  submitLabel: string;
  /**
   * Resolves with Better Auth's error, nothing once the code worked, or
   * `false` when the page did not send the code and marked what to fix
   * itself.
   */
  onSubmitCode: (code: string) => Promise<EmailCodeError | false | undefined>;
  /** When the current code went out, in epoch milliseconds. */
  sentAt: number;
  onResend: () => void;
  isResending: boolean;
}

/**
 * The second half of an email code on its own: the field and the button that
 * spends the code. The code is typed into the tab that asked for it, so
 * whatever that tab was doing (a sign-in for another app, a gated action)
 * carries on.
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
  const describeError = useDescribeEmailCodeError();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);

  function showError(message: string) {
    setError(message);
    // Submitting left focus on the button; send it back to the field.
    fieldRef.current?.focus();
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length !== EMAIL_CODE_LENGTH) {
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
    <form noValidate className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <EmailCodeField
        inputRef={fieldRef}
        // Focus follows the step that just appeared.
        autoFocus
        value={code}
        onChange={setCode}
        email={email}
        error={error ?? undefined}
        sentAt={sentAt}
        onResend={onResend}
        isResending={isResending || isLocked}
        disabled={isAccepted}
      />
      <Button type="submit" disabled={isLocked}>
        {isLocked ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
        ) : null}
        {submitLabel}
      </Button>
    </form>
  );
}
