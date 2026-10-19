import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title?: string;
  description: string;
  /** The next step. An empty state should never be a dead end. */
  action?: React.ReactNode;
  className?: string;
  /** Extra classes for the description, e.g. `text-balance` for a two-line hint. */
  descriptionClassName?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  descriptionClassName,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "content-rise flex flex-col items-center justify-center gap-1 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden
          className="bg-quinary text-muted-foreground mb-2 flex size-10 items-center justify-center rounded-full"
        >
          <Icon className="size-5" />
        </span>
      ) : null}
      {title ? (
        <h2 className="text-foreground text-base font-semibold text-balance">
          {title}
        </h2>
      ) : null}
      <p
        className={cn(
          "text-muted-foreground max-w-[44ch] text-sm text-pretty",
          descriptionClassName,
        )}
      >
        {description}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
