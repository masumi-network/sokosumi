import { Check, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** active carries the view's one Iris mark; busy is work in flight; todo is not started. */
export type SeoStepMark = "active" | "done" | "busy" | "todo";

/** A staggered step enters a little after the one before it. */
const STEP_STAGGER_MS = 100;

export function SeoStepList({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    // The role keeps list semantics in Safari, which drops them with list-style none.
    <ol role="list" aria-label={label}>
      {children}
    </ol>
  );
}

/** One numbered step: a mark on a rail, a title, a line of help and its controls. */
export function SeoStep({
  index,
  title,
  body,
  mark,
  doneLabel,
  last = false,
  heading: Heading = "h3",
  stagger = false,
  children,
}: {
  index: number;
  title: string;
  /** Left out where the controls say all there is to say. */
  body?: ReactNode;
  mark: SeoStepMark;
  /** Read out for a finished step, where the number is replaced by a check. */
  doneLabel?: string;
  last?: boolean;
  /** The level under the card title that holds the list. */
  heading?: "h3" | "h4";
  /** Only for a view that shows once. A tab that remounts must not replay it. */
  stagger?: boolean;
  children?: ReactNode;
}) {
  const quiet = mark === "todo";
  return (
    <li
      className={cn("content-rise relative flex gap-4", !last && "pb-6")}
      style={
        stagger
          ? { animationDelay: `${(index - 1) * STEP_STAGGER_MS}ms` }
          : undefined
      }
      aria-current={mark === "active" ? "step" : undefined}
    >
      {last ? null : (
        <span
          aria-hidden
          className="bg-border absolute start-4 top-10 bottom-2 w-px"
        />
      )}
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium",
          mark === "active"
            ? "bg-primary text-primary-foreground"
            : mark === "done"
              ? "bg-foreground text-background"
              : "border-border bg-background text-muted-foreground border",
        )}
      >
        {mark === "done" ? (
          <Check className="check-pop size-4" />
        ) : mark === "busy" ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
        ) : (
          index
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1 pt-1">
        <Heading
          className={cn(
            "text-base",
            // The next step is heavier, so weight marks it as well as colour.
            mark === "active" || mark === "busy"
              ? "font-semibold"
              : "font-medium",
            quiet && "text-muted-foreground",
          )}
        >
          {title}
          {mark === "done" && doneLabel ? (
            <span className="sr-only"> ({doneLabel})</span>
          ) : null}
        </Heading>
        {body ? (
          <div className="text-muted-foreground max-w-prose text-sm text-pretty">
            {body}
          </div>
        ) : null}
        {children ? <div className="pt-3">{children}</div> : null}
      </div>
    </li>
  );
}
