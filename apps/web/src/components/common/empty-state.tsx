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
  /**
   * Announces the title and description, e.g. `alert` for a load error.
   * The action stays outside the live region.
   */
  messageRole?: "alert" | "status";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  descriptionClassName,
  messageRole,
}: EmptyStateProps) {
  const message = (
    <>
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
    </>
  );
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
      {messageRole ? (
        <div className="flex flex-col items-center gap-1" role={messageRole}>
          {message}
        </div>
      ) : (
        message
      )}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
