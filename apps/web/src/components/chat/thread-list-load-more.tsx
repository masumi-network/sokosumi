"use client";

import { Loader2 } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { useLoadWhenVisible } from "@/hooks/use-load-when-visible";

export type ThreadListLoadMoreStatus = "idle" | "loading" | "failed";

interface ThreadListLoadMoreProps {
  /** The last row loaded, which is where this boundary sits. */
  boundaryKey: string;
  status: ThreadListLoadMoreStatus;
  onLoad: () => void;
  labels: {
    /** Idle: what pressing it does. */
    load: string;
    loading: string;
    error: string;
    retry: string;
  };
}

/**
 * The end of a loaded Thread list, where the next page comes in (SOK-1159):
 * the Threads page's groups and the room's Thread panel.
 *
 * It loads on its own as soon as it scrolls into view, the Notification
 * Center's older boundary on the same hook, and it is still a centred button
 * so a click works where there is no observer to watch it. A failed load
 * stays on the row with a retry and stops loading on its own until the
 * reader asks again, rather than hammering a server that just said no.
 */
export function ThreadListLoadMore({
  boundaryKey,
  status,
  onLoad,
  labels,
}: ThreadListLoadMoreProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useLoadWhenVisible(rowRef, {
    armed: status === "idle",
    boundaryKey,
    onVisible: onLoad,
  });
  const isLoading = status === "loading";

  return (
    <div
      ref={rowRef}
      data-testid="thread-list-load-more"
      className="flex justify-center px-2 pt-2 pb-1"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-auto flex-wrap gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
        disabled={isLoading}
        aria-busy={isLoading}
        onClick={onLoad}
      >
        {status === "failed" ? (
          <>
            <span role="alert" className="text-destructive">
              {labels.error}
            </span>
            {labels.retry}
          </>
        ) : isLoading ? (
          <>
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            {labels.loading}
          </>
        ) : (
          // Idle is a button waiting to be pressed, not a load in flight: it
          // is what a reader sees for good where no observer runs.
          labels.load
        )}
      </Button>
    </div>
  );
}
