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
 * Fills are the -quaternary step, not -quinary. The quinary steps sit at 93
 * to 95 percent lightness, where no hue has room to separate from any other:
 * all 15 pairs measured under OKLab dE 6.0 and the worst under 1.0. At
 * -quaternary that falls to 1 pair of 15, and the one that stays close is
 * neutral against accent, which never competed as a category.
 *
 * `working` reads the --status-working ramp, the same one the task status
 * badge paints. It used to have its own --semantic-info ramp, but every
 * consumer of that meant "in flight right now" rather than "here is
 * information", so the two were one role under two names.
 */
const SURFACE_CLASSES: Record<StatusTone, string> = {
  neutral: "border-border bg-muted",
  working: "border-status-working-tertiary bg-status-working-quaternary",
  success: "border-semantic-success-tertiary bg-semantic-success-quaternary",
  warning: "border-semantic-warning-tertiary bg-semantic-warning-quaternary",
  danger:
    "border-semantic-destructive-tertiary bg-semantic-destructive-quaternary",
  accent: "border-primary-tertiary bg-primary-quaternary",
};

/** A tone's text, for a status said in words outside a badge too. */
export const STATUS_TONE_TEXT_CLASS: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  working: "text-status-working-label",
  success: "text-semantic-success",
  warning: "text-semantic-warning",
  danger: "text-semantic-destructive-label",
  accent: "text-primary-variant",
};

/** A tone's dot, for a status drawn as a dot outside a badge too. */
export const STATUS_TONE_DOT_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  working: "bg-status-working",
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
        SURFACE_CLASSES[tone],
        STATUS_TONE_TEXT_CLASS[tone],
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
