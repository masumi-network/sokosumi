"use client";

import { toast } from "sonner";

interface TaskIdentifierCopyProps {
  identifier: string;
  /** Accessible name, e.g. "Copy task ID". */
  copyLabel: string;
  copiedMessage: string;
  copyErrorMessage: string;
}

/** The task's short id (SOK-12) as quiet text; a click copies it. */
export function TaskIdentifierCopy({
  identifier,
  copyLabel,
  copiedMessage,
  copyErrorMessage,
}: TaskIdentifierCopyProps) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(identifier);
      toast.success(copiedMessage);
    } catch {
      toast.error(copyErrorMessage);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`${copyLabel}: ${identifier}`}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo rounded-sm text-sm tabular-nums transition-colors outline-none focus-visible:ring-2"
    >
      {identifier}
    </button>
  );
}
