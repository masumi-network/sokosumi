"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  className: string;
  /** Its own action; without one it submits the form's action. */
  formAction?: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
}

/**
 * Submits its form, with its own action when it has one. Every button in the
 * form stays disabled while any of them runs. With its own action, only the
 * one that was pressed shows the spinner; without, it shows the spinner
 * whenever the form runs, so give a form like that just this one button.
 */
export function SubmitButton({
  className,
  formAction,
  children,
}: SubmitButtonProps) {
  const { pending, action } = useFormStatus();
  const busy = pending && (formAction === undefined || action === formAction);

  return (
    <button
      className={className}
      type="submit"
      formAction={formAction}
      disabled={pending}
      aria-busy={busy || undefined}
    >
      <span className="button-label">{children}</span>
      {busy ? <span className="button-spinner" aria-hidden="true" /> : null}
    </button>
  );
}
