import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-semantic-info-tertiary bg-semantic-info-quinary text-semantic-info",
  success:
    "border-semantic-success-tertiary bg-semantic-success-quinary text-semantic-success",
  warning:
    "border-semantic-warning-tertiary bg-semantic-warning-quinary text-semantic-warning",
  danger:
    "border-semantic-destructive-tertiary bg-semantic-destructive-quinary text-semantic-destructive",
  accent: "border-primary/30 bg-primary/10 text-primary",
};

const DOT_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-semantic-info",
  success: "bg-semantic-success",
  warning: "bg-semantic-warning",
  danger: "bg-semantic-destructive",
  accent: "bg-primary",
};

interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
  /** Pulses the dot for in-flight states. */
  live?: boolean;
  className?: string;
}

/**
 * Compact, bordered status pill on the semantic palette. Server-safe.
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
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          DOT_CLASSES[tone],
          live && "motion-safe:animate-pulse",
        )}
      />
      {children}
    </span>
  );
}
