import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusTone =
  | "neutral"
  | "working"
  | "success"
  | "warning"
  | "danger"
  | "accent";

/**
 * The chip is neutral for every tone and colour lives on the dot alone (the
 * Masumi Family guide, 5.2): the green, yellow and Iris marks measure 2.00,
 * 1.44 and 2.67:1 on white, so the word carries the status and is plain text.
 * `working` paints --status-working, the colour the task status badge uses.
 */
const SURFACE_CLASS = "border-border bg-muted";

/** A tone's text, for a status said in words outside a badge too. */
export function statusToneTextClass(tone: StatusTone): string {
  return tone === "neutral" ? "text-muted-foreground" : "text-foreground";
}

/** A tone's dot, for a status drawn as a dot outside a badge too. */
export const STATUS_TONE_DOT_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  working: "bg-status-working",
  success: "bg-semantic-success",
  warning: "bg-semantic-warning",
  danger: "bg-semantic-destructive",
  accent: "bg-foreground",
};

interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
  /** Pulses the dot for in-flight states. */
  live?: boolean;
  className?: string;
}

/**
 * Compact, bordered status pill; colour lives on the dot. Server-safe.
 */
export function StatusBadge({
  tone,
  children,
  live = false,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-1.5 text-xs font-medium leading-none",
        SURFACE_CLASS,
        statusToneTextClass(tone),
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          STATUS_TONE_DOT_CLASS[tone],
          live && "motion-safe:animate-pulse",
        )}
      />
      {children}
    </span>
  );
}
