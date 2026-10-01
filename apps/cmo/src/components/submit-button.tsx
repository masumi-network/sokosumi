"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  className: string;
  children: ReactNode;
}

/**
 * Submits its form and stays disabled while the form's action runs. The
 * spinner only shows once the wait passes 300ms (see `.button-spinner`), so a
 * quick action never flashes it.
 */
export function SubmitButton({ className, children }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
    >
      <span className="button-label">{children}</span>
      {pending ? <span className="button-spinner" aria-hidden="true" /> : null}
    </button>
  );
}
