"use client";

import { QueryClientContext } from "@tanstack/react-query";
import { Pin } from "lucide-react";
import { useContext, useOptimistic, useTransition } from "react";
import { pinProjectAction, unpinProjectAction } from "@/app/projects/actions";
import { cn } from "@/lib/utils";

interface ProjectPinButtonProps {
  projectId: string;
  /** The reader's own Pin, from `starredAt` on the row. */
  isPinned: boolean;
  labels: { pin: string; unpin: string };
  className?: string;
}

/**
 * Pins a project from the surface the reader browses on. Product UI says Pin;
 * the action underneath says star (ADR 0017).
 *
 * Always rendered rather than revealed on hover: a hover-only control does not
 * exist on a touch device, which is where half this list is read. Chat hides
 * the same action in a row menu, but that menu already carries five other
 * items — one here would hold nothing else (ADR-0036).
 */
export function ProjectPinButton({
  projectId,
  isPinned,
  labels,
  className,
}: ProjectPinButtonProps) {
  // Read through the context rather than `useQueryClient`, which throws when
  // there is no provider. Refreshing the sidebar's cache is best-effort: this
  // button's job is to Pin, and it must stay renderable on its own.
  const queryClient = useContext(QueryClientContext);
  const [isPending, startTransition] = useTransition();
  const [optimisticPinned, setOptimisticPinned] = useOptimistic(isPinned);

  function toggle() {
    const next = !optimisticPinned;
    startTransition(async () => {
      setOptimisticPinned(next);
      try {
        await (next
          ? pinProjectAction({ projectId })
          : unpinProjectAction({ projectId }));
      } catch {
        // useOptimistic rolls the icon back when the transition ends without
        // the server state having moved, so there is nothing to undo here.
        // Both calls are idempotent at Core, so a retry is always safe.
        return;
      }
      // The flyout caches Pins under its own key; without this it keeps
      // showing the old set until something else refetches it.
      await queryClient?.invalidateQueries({
        queryKey: ["sidebar-pinned-projects"],
      });
    });
  }

  const label = optimisticPinned ? labels.unpin : labels.pin;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-label={label}
      title={label}
      aria-pressed={optimisticPinned}
      data-testid="project-pin-button"
      className={cn(
        // The row around this is a link, so the button sits beside it rather
        // than inside it — nesting would swallow the click and is invalid.
        "text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors outline-hidden focus-visible:ring-2",
        "disabled:pointer-events-none disabled:opacity-50",
        optimisticPinned && "text-foreground",
        className,
      )}
    >
      <Pin
        aria-hidden
        className={cn("size-4", optimisticPinned && "fill-current")}
      />
    </button>
  );
}
