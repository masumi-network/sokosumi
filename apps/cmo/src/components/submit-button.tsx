"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  className: string;
  /** Its own action; without one it submits the form's action. */
  formAction?: () => Promise<void>;
  children: ReactNode;
}

/**
 * Submits its form with its own action. Every button in the form stays
 * disabled while any of them runs; only the one that was pressed shows the
 * spinner.
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
