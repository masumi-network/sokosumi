"use client";

import { Copy } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`${copyAriaLabelPrefix}: ${identifier}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo inline-flex items-center gap-1 rounded-sm text-sm tabular-nums transition-colors outline-none focus-visible:ring-2"
        >
          {identifier}
          <Copy className="size-3.5 shrink-0" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {copyAriaLabelPrefix}
      </TooltipContent>
    </Tooltip>
  );
}
