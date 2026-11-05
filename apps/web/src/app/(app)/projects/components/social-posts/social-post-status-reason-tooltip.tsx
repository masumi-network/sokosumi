"use client";

import { useId, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Reason on a Failed or Missed chip. Hover, keyboard focus, and a tap on a
 * phone all show it. Long text wraps so it stays on the screen. The chip
 * sits inside a calendar card, so the tap must not open the post.
 */
export function SocialPostStatusReasonTooltip({
  label,
  reason,
  children,
}: {
  label: string;
  reason: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span
          aria-describedby={descriptionId}
          aria-label={label}
          className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="social-post-status-reason"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((current) => !current);
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          tabIndex={0}
        >
          {children}
        </span>
      </TooltipTrigger>
      <span className="sr-only" id={descriptionId}>
        {reason}
      </span>
      <TooltipContent
        className="max-w-64 text-pretty"
        side="top"
        sideOffset={6}
      >
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}
