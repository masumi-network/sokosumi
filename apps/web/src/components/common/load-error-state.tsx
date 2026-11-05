import { CloudOff, RotateCw } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LoadErrorStateProps {
  /** What failed, in a few words. */
  title: string;
  /** One line of help. It should say what still works or what to do next. */
  description: string;
  retryLabel: string;
  onRetry: () => void;
  /** The retry is running. The button keeps its size and ignores clicks. */
  retrying?: boolean;
  /**
   * `card` takes the place of the content that failed to load and reads like
   * the empty states around it. `banner` is a slim line above content that
   * still works.
   */
  variant?: "card" | "banner";
  className?: string;
  "data-testid"?: string;
}

/**
 * A part of a page could not load. The rest of the page keeps working, so
 * this says which part failed and offers one clear way to try again.
 *
 * It borrows the empty state's layout, spacing and icon, so a failure sits
 * quietly next to "No drafts yet." instead of looking like a crash.
 */
export function LoadErrorState({
  title,
  description,
  retryLabel,
  onRetry,
  retrying = false,
  variant = "card",
  className,
  "data-testid": testId,
}: LoadErrorStateProps) {
  const retry = (
    <Button
      className={cn(
        variant === "card"
          ? "min-h-11 md:min-h-10"
          : "h-11 w-full sm:w-auto md:h-8",
      )}
      loading={retrying}
      size={variant === "card" ? "default" : "sm"}
      type="button"
      variant="outline"
      onClick={onRetry}
    >
      <RotateCw aria-hidden />
      {retryLabel}
    </Button>
  );

  if (variant === "banner") {
    return (
      // A polite status: the page itself loaded, one part of it did not.
      <div
        className={cn(
          "bg-card flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center",
          className,
        )}
        data-testid={testId}
        role="status"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden
            className="bg-quinary text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
          >
            <CloudOff className="size-4" />
          </span>
          <p className="min-w-0 pt-1 text-pretty">
            <span className="text-foreground font-medium">{title}</span>{" "}
            <span className="text-muted-foreground">{description}</span>
          </p>
        </div>
        {retry}
      </div>
    );
  }

  return (
    <div className={className} data-testid={testId} role="alert">
      <EmptyState
        action={retry}
        description={description}
        // Two even lines, not one long line and a stray "try again."
        descriptionClassName="text-balance"
        icon={CloudOff}
        title={title}
      />
    </div>
  );
}
