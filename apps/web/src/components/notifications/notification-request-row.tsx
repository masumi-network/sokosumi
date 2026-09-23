import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * How loudly a request asks. Filled means the reader is blocked until they
 * act, marked means they should act soon, and quiet is an offer they can
 * leave. The colour is the notice's own tone; the fill is the urgency.
 */
export type NotificationRequestEmphasis =
  | "filled-warning"
  | "filled-destructive"
  | "marked"
  | "quiet";

const EMPHASIS_STYLES = {
  "filled-warning": {
    row: "bg-semantic-warning-quinary",
    rail: "bg-semantic-warning forced-colors:bg-[Highlight]",
    circle: "bg-semantic-warning-quaternary text-semantic-warning",
    title: "font-medium text-semantic-warning",
  },
  "filled-destructive": {
    row: "bg-semantic-destructive-quinary",
    rail: "bg-semantic-destructive forced-colors:bg-[Highlight]",
    circle: "bg-semantic-destructive-quaternary text-semantic-destructive",
    title: "font-medium text-semantic-destructive",
  },
  marked: {
    row: "",
    rail: "bg-semantic-warning forced-colors:bg-[Highlight]",
    circle: "bg-semantic-warning-quaternary text-semantic-warning",
    title: "font-medium",
  },
  quiet: {
    row: "",
    rail: "bg-transparent",
    circle: "bg-quinary text-muted-foreground",
    title: "",
  },
} as const satisfies Record<
  NotificationRequestEmphasis,
  { row: string; rail: string; circle: string; title: string }
>;

/** Lets a long label wrap. Pass through `cn` so it beats the sm button's `h-8` and `whitespace-nowrap`. */
export const notificationRequestActionClassName =
  "h-auto max-w-full whitespace-normal text-left";

interface NotificationRequestRowProps {
  emphasis: NotificationRequestEmphasis;
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

/**
 * Something the account asks of the reader, drawn as a row of the Needs you
 * list rather than a card above it: the same rail, circle and text column as
 * a notification row, so the tab reads as one list.
 *
 * The row itself is not a control. The action is, and a request with
 * nothing to press (a blocked permission, an install step) is just text.
 * The action sits beside the text while the text keeps 12rem, and drops
 * under it when a long label would squeeze it thinner, which is what the
 * panel's 24rem does to most of them. The 12rem floor yields when the
 * column is narrower, so a phone page does not clip the row.
 */
export function NotificationRequestRow({
  emphasis,
  icon: Icon,
  title,
  description,
  action,
}: NotificationRequestRowProps) {
  const styles = EMPHASIS_STYLES[emphasis];

  return (
    <div className={cn("flex w-full", styles.row)}>
      <span className={cn("w-0.5 shrink-0", styles.rail)} aria-hidden />
      <div className="flex min-w-0 flex-1 items-start gap-3 p-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            styles.circle,
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
          <div className="flex min-w-[min(12rem,100%)] flex-1 flex-col gap-1">
            <p className={cn("text-sm text-pretty", styles.title)}>{title}</p>
            <p className="text-muted-foreground text-xs text-pretty">
              {description}
            </p>
          </div>
          {action ? (
            <div className="flex max-w-full shrink-0 flex-col items-start gap-2">
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
