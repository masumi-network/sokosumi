"use client";

import type { MouseEvent, ReactNode } from "react";
import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  className: string;
  /** Its own action; without one it submits the form's action. */
  formAction?: (formData: FormData) => void | Promise<void>;
  /** Submit even when the form's other fields are invalid. */
  formNoValidate?: boolean;
  children: ReactNode;
}

function preventResubmit(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

/**
 * Submits its form, with its own action when it has one. While any of them
 * runs, the others in the form are disabled and the running one keeps its
 * label, its size and focus: it is aria-disabled, ignores clicks and Enter,
 * and draws a bar sweeping along its bottom edge. With its own action, only
 * the one that was pressed shows the bar; without, it shows the bar whenever
 * the form runs, so give a form like that just this one button.
 */
export function SubmitButton({
  className,
  formAction,
  formNoValidate,
  children,
}: SubmitButtonProps) {
  const { pending, action } = useFormStatus();
  const busy = pending && (formAction === undefined || action === formAction);

  return (
    <button
      className={className}
      type="submit"
      formAction={formAction}
      formNoValidate={formNoValidate}
      disabled={pending && !busy}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={busy ? preventResubmit : undefined}
    >
      <span className="button-label">{children}</span>
      {busy ? <span className="button-loading-bar" aria-hidden="true" /> : null}
    </button>
  );
}
