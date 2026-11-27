import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";

import type { SeoFixIssue } from "./project-seo-fix-results";

type Action = ProjectSeoWorkspace["actions"][number];

/** Per fix action: the findings it fixes as one key, its issues, the time of its check, and whether a Task still works on it. */
export type SeoFixWork = Map<
  Action,
  {
    work: string;
    issues: SeoFixIssue[];
    observedAt: Date;
    live: boolean;
  }
>;

/** Leaves one card per issue in `actions`, and moves the Tasks of the cards that leave to the cards that stay. */
export function keepNewestSeoFixCards(
  actions: ProjectSeoWorkspace["actions"],
  fixWork: SeoFixWork,
  tasks: Array<{ id: string; completedAt: Date | null }>,
) {
  // One card per issue. A later check that still finds the issue proposes its fix again: the cards of the newest
  // check stay, whatever their status, and the older cards for the same findings leave. A Task that still works
  // on the issue moves to a later card without a Task, the one with the same title first.
  const byWork = new Map<string, ProjectSeoWorkspace["actions"]>();
  for (const action of actions) {
    const work = fixWork.get(action)?.work;
    if (work) byWork.set(work, [...(byWork.get(work) ?? []), action]);
  }
  const replaced = new Set<ProjectSeoWorkspace["actions"][number]>();
  for (const group of byWork.values()) {
    const at = (action: ProjectSeoWorkspace["actions"][number]) =>
      fixWork.get(action)!.observedAt.getTime();
    // A card whose Task failed, was cancelled or is gone does no work on the issue: it replaces no card, and no
    // card replaces it.
    const working = group.filter(
      (action) => !action.taskId || fixWork.get(action)!.live,
    );
    const newest = Math.max(...working.map(at));
    // The newest check that found the issue, a card with a dead Task included: a Task that ended before it did
    // not hold the fix.
    const found = Math.max(...group.map(at));
    const later = working.filter((action) => at(action) === newest);
    // Cards of the reader's own Tasks: an older card has no later card to move to.
    const own = later.every((card) => Boolean(card.taskId));
    const moving: ProjectSeoWorkspace["actions"] = [];
    for (const action of working) {
      if (at(action) === newest) continue;
      replaced.add(action);
      if (
        !fixWork.get(action)!.live ||
        (action.status !== "task_created" && action.status !== "implemented")
      )
        continue;
      // A Task that ended before the later check did not hold the fix: the later card is an open action again.
      // A finished Task without an end time gives no proof either way, so the later card stays open too.
      if (action.status === "implemented") {
        const done = tasks.find(
          (task) => task.id === action.taskId,
        )?.completedAt;
        if (!done || found > done.getTime()) continue;
      }
      moving.push(action);
    }
    const free = () =>
      later.filter((card) => !card.taskId && card.status === "recommended");
    const move = (
      action: ProjectSeoWorkspace["actions"][number],
      card: ProjectSeoWorkspace["actions"][number] | undefined,
    ) => {
      if (!card) return false;
      card.taskId = action.taskId;
      card.status = action.status;
      return true;
    };
    // The same title first for every Task, then any card left.
    const unmatched = moving.filter(
      (action) =>
        !move(
          action,
          free().find((card) => card.title === action.title),
        ),
    );
    // A Task that finds no later card keeps its own card, unless the later cards all carry the reader's Tasks.
    for (const action of unmatched)
      if (!move(action, free()[0]) && !own) replaced.delete(action);
  }
  if (replaced.size)
    actions.splice(
      0,
      actions.length,
      ...actions.filter((action) => !replaced.has(action)),
    );
}
