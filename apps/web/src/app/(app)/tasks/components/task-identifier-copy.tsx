"use client";

import { copyTextWithToast } from "@/hooks/use-clipboard";

interface TaskIdentifierCopyProps {
  identifier: string;
  copyLabel: string;
  copiedMessage: string;
  copyErrorMessage: string;
}

export function TaskIdentifierCopy({
  identifier,
  copyLabel,
  copiedMessage,
  copyErrorMessage,
}: TaskIdentifierCopyProps) {
  function handleCopy() {
    void copyTextWithToast(identifier, {
      copySuccessMessage: copiedMessage,
      copyErrorMessage,
    });
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
