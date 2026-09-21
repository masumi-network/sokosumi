"use client";

import { QueryClientContext } from "@tanstack/react-query";
import { Pin } from "lucide-react";
import { useContext, useState, useTransition } from "react";
import { pinProjectAction, unpinProjectAction } from "@/app/projects/actions";
import { PINNED_PROJECTS_QUERY_KEY } from "@/hooks/use-pinned-projects";
import { cn } from "@/lib/utils";

interface ProjectPinButtonProps {
  projectId: string;
  /** The reader's own Pin, from `starredAt` on the row. */
  isPinned: boolean;
  /** Closing counts as closed here: both are on their way out of the list. */
  isClosed?: boolean;
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
  isClosed = false,
  labels,
  className,
}: ProjectPinButtonProps) {
  // Read through the context rather than `useQueryClient`, which throws when
  // there is no provider. Refreshing the sidebar's cache is best-effort: this
  // button's job is to Pin, and it must stay renderable on its own.
  const queryClient = useContext(QueryClientContext);
  const [isPending, startTransition] = useTransition();
  // Committed state, not `useOptimistic`. An optimistic value is discarded
  // when the transition ends and falls back to `isPinned` — which on the
  // projects list comes from the server-rendered row's `starredAt` and is
  // never refreshed, so a Pin flipped blue and snapped straight back to grey.
  const [pinned, setPinned] = useState(isPinned);
  // Whatever the server last told us. When that changes — a navigation, a
  // refresh, a refetched Pin list — it wins over what this button remembers.
  const [serverPinned, setServerPinned] = useState(isPinned);
  if (serverPinned !== isPinned) {
    setServerPinned(isPinned);
    setPinned(isPinned);
  }

  function toggle() {
    const next = !pinned;
    setPinned(next);
    startTransition(async () => {
      try {
        await (next
          ? pinProjectAction({ projectId })
          : unpinProjectAction({ projectId }));
      } catch {
        // Put the icon back; both calls are idempotent at Core, so the
        // reader can simply click again.
        setPinned(!next);
        return;
      }
      // The flyout caches Pins under its own key; without this it keeps
      // showing the old set until something else refetches it.
      // Keyed on the root, so every scope's entry refreshes and both the
      // sidebar flyout and the project header pick the change up.
      await queryClient?.invalidateQueries({
        queryKey: [PINNED_PROJECTS_QUERY_KEY],
      });
    });
  }

  // A closed project is filtered out of the Pin list, so Pinning one would
  // create a Pin that never appears anywhere. Unpinning stays available while
  // a Pin exists, or closing a project would strand it with no way back —
  // which is also why Core's unstar route accepts a closed project.
  if (isClosed && !pinned) {
    return null;
  }

  const label = pinned ? labels.unpin : labels.pin;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-label={label}
      title={label}
      aria-pressed={pinned}
      data-testid="project-pin-button"
      className={cn(
        // The row around this is a link, so the button sits beside it rather
        // than inside it — nesting would swallow the click and is invalid.
        "focus-visible:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors outline-hidden focus-visible:ring-2",
        "disabled:pointer-events-none disabled:opacity-50",
        // Pinned carries three signals at once — hue, fill and a tinted
        // ground — because at 16px a filled pin is barely distinguishable
        // from an outlined one, and one step of grey did not read at all.
        // Solid ramp steps, not an opacity modifier: the colour-token rule is
        // absolute, and this is the same pairing the task-created badge uses.
        pinned
          ? "text-primary bg-primary-quinary hover:bg-primary-quaternary"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Pin aria-hidden className={cn("size-4", pinned && "fill-current")} />
    </button>
  );
}
