"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { cn } from "@/lib/utils";

import {
  EMAIL_CODE_LENGTH,
  type EmailCodeError,
  EmailCodeInput,
  useEmailCodeRefusal,
} from "./email-code-field";
import { ResendCodeButton } from "./resend-code-button";

interface EmailCodeFormProps {
  /** Where the code went, when the page does not already show it. */
  email?: string | undefined;
  /** Resolves with Better Auth's error, or nothing once the code worked. */
  onSubmitCode: (code: string) => Promise<EmailCodeError | undefined>;
  /** When the current code went out, in epoch milliseconds. */
  sentAt: number;
  onResend: () => void;
  isResending: boolean;
}

/**
 * The second half of an email code on its own: the underlined slots, a status
 * line for the check and its refusal, and a way to ask again. There is no
 * button: the sixth digit sends the code. It is typed into the tab that asked
 * for it, so whatever that tab was doing (a gated action) carries on.
 */
export function EmailCodeForm({
  email,
  onSubmitCode,
  sentAt,
  onResend,
  isResending,
}: EmailCodeFormProps) {
  const t = useTranslations("Components.EmailCodeForm");
  const hintId = useId();
  const statusId = useId();
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

  // A completed field and Enter both end here, so a code is spent one way
  // only. The field hands its code over before the state holding it has
  // rendered.
  const submitCode = async (submitted: string) => {
    if (submitting.current) return;
    if (submitted.length !== EMAIL_CODE_LENGTH) {
      // Enter in the field; focus is still there, so the reason is read out.
      flushSync(() => setError(t("incomplete")));
      fieldRef.current?.focus();
      return;
    }

    submitting.current = true;
    setError(null);
    setIsVerifying(true);
    let accepted = false;
    try {
      // A check that never answered is refused like a wrong code: with no
      // button, the same code can only go again once the field is clear.
      const answer = await onSubmitCode(submitted).catch(() => ({}));
      if (answer) {
        setError(refusal.refuse(answer));
        return;
      }
      // The page is leaving or the dialog is closing; a second submit would
      // spend a code that already worked.
      accepted = true;
      setIsAccepted(true);
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
    <form
      noValidate
      className="flex flex-col items-center"
      onSubmit={handleSubmit}
    >
      <EmailCodeInput
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
        invalid={error !== null}
        describedBy={[hintId, error ? statusId : null]
          .filter(Boolean)
          .join(" ")}
        disabled={isLocked}
      />
      {/* The slots show the length and the page shows the address, so the
          line only tells a screen reader a code went out. */}
      <p id={hintId} className="sr-only">
        {email ? t("sent", { email }) : t("sentNoAddress")}
      </p>
      {/* Always rendered, so a screen reader hears what appears in it. */}
      <div
        id={statusId}
        role="status"
        className={cn(
          "text-center text-sm",
          error ? "text-destructive" : "text-muted-foreground",
          // Takes no space until it says something.
          (isVerifying || error) && "mt-4",
        )}
      >
        {isVerifying ? t("checking") : error}
      </div>
      <div className="mt-4">
        <ResendCodeButton
          sentAt={sentAt}
          onResend={onResend}
          isSending={isResending || isLocked}
        />
      </div>
    </form>
  );
}
