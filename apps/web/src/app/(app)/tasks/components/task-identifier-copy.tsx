"use client";

import { copyTextWithToast } from "@/hooks/use-clipboard";

interface TaskIdentifierCopyProps {
  identifier: string;
  copyAriaLabelPrefix: string;
  copiedMessage: string;
  copyErrorMessage: string;
}

export function TaskIdentifierCopy({
  identifier,
  copyAriaLabelPrefix,
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
      aria-label={`${copyAriaLabelPrefix}: ${identifier}`}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo rounded-sm text-sm tabular-nums transition-colors outline-none focus-visible:ring-2"
    >
      {identifier}
    </button>
  );
}
