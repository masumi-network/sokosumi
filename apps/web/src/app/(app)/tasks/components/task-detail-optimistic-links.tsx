"use client";

import Link from "next/link";
import {
  createContext,
  type ReactNode,
  useContext,
  useOptimistic,
} from "react";

import type { VisibleTaskLink } from "./task-detail-api-types";

/**
 * A link is named by its peer task: Core holds at most one link per pair of
 * tasks (`task_link_task_pair_key`).
 */
export type TaskLinkChange =
  | { hidePeerTaskId: string }
  | { add: VisibleTaskLink };

type OptimisticTaskLinks = readonly [
  changes: readonly TaskLinkChange[],
  showChange: (change: TaskLinkChange) => void,
];

const NO_CHANGES: readonly TaskLinkChange[] = [];
const NOT_SHOWN: OptimisticTaskLinks = [NO_CHANGES, () => {}];

const TaskDetailLinksContext = createContext<OptimisticTaskLinks | null>(null);

/**
 * Link changes the task page shows before Core answers. The header menu
 * writes them; the related tasks list and the parent line sit in other
 * subtrees and read them here.
 */
export function TaskDetailLinksProvider({ children }: { children: ReactNode }) {
  const value = useOptimistic(NO_CHANGES, (changes, change: TaskLinkChange) => [
    ...changes,
    change,
  ]);
  return (
    <TaskDetailLinksContext.Provider value={value}>
      {children}
    </TaskDetailLinksContext.Provider>
  );
}

/**
 * The open link changes and a setter to call inside the transition of a link
 * write. React drops the changes when that transition ends: with the
 * revalidated links, or alone when the write failed. Outside a provider (the
 * admin and developer views) nothing is shown early.
 */
export function useOptimisticTaskLinks(): OptimisticTaskLinks {
  return useContext(TaskDetailLinksContext) ?? NOT_SHOWN;
}

function isPeerTaskHidden(
  changes: readonly TaskLinkChange[],
  peerTaskId: string,
) {
  return changes.some(
    (change) =>
      "hidePeerTaskId" in change && change.hidePeerTaskId === peerTaskId,
  );
}

export function applyTaskLinkChanges(
  links: VisibleTaskLink[],
  changes: readonly TaskLinkChange[],
): VisibleTaskLink[] {
  let shown = links;
  for (const change of changes) {
    if ("hidePeerTaskId" in change) {
      shown = shown.filter((link) => link.id !== change.hidePeerTaskId);
    } else if (!shown.some((link) => link.id === change.add.id)) {
      // A peer that already has a link cannot get a second one: Core refuses.
      shown = [...shown, change.add];
    }
  }
  return shown;
}

/** The "cloned from" line under the title. It goes when its link is removed. */
export function TaskParentLine({
  parent,
  href,
  children,
}: {
  parent: { id: string };
  href: string;
  children: ReactNode;
}) {
  const [changes] = useOptimisticTaskLinks();
  if (isPeerTaskHidden(changes, parent.id)) return null;
  return (
    <p className="text-muted-foreground text-sm">
      <Link
        href={href}
        className="text-foreground underline underline-offset-4"
      >
        {children}
      </Link>
    </p>
  );
}
