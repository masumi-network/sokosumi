import type { TaskLinkPeerTaskRow } from "@/types/task-link";

/** Links a plan walks, named from the walked Task's side, as in Task links. */
export type TaskPlanRelation = "blocked_by" | "parent";

/** How many links away from the opened Task the plan reaches. */
export const TASK_PLAN_MAX_DEPTH = 3;
/** Most rows one plan shows. */
export const TASK_PLAN_MAX_ITEMS = 30;

export interface TaskPlanEdge {
  relation: TaskPlanRelation;
  peer: TaskLinkPeerTaskRow;
}

export interface TaskPlanItem {
  depth: number;
  relation: TaskPlanRelation;
  task: TaskLinkPeerTaskRow;
  /** `loops_back`: an ancestor on this path. `shown_above`: an earlier row. */
  repeat: "loops_back" | "shown_above" | null;
  /** At the depth limit and has visible links of its own. */
  hasMore: boolean;
}

export interface TaskPlan {
  items: TaskPlanItem[];
  truncated: boolean;
}

const RELATION_ORDER: readonly TaskPlanRelation[] = ["blocked_by", "parent"];

/**
 * Depth-first rows of what holds `rootId` up (blockers) and what it is split
 * into (sub-tasks), blockers first, then each relation in link order. A Task
 * is expanded where it is first met with depth to spare, and again only on a
 * shorter path (its links then reach further); other sightings are marked.
 * `edgesByTask` must already hold only Tasks the reader may see.
 */
export function buildTaskPlan(
  rootId: string,
  edgesByTask: ReadonlyMap<string, readonly TaskPlanEdge[]>,
): TaskPlan {
  const items: TaskPlanItem[] = [];
  const shown = new Set<string>([rootId]);
  /** Shallowest depth each Task's own links were walked from. */
  const expandedAt = new Map<string, number>();
  let truncated = false;

  function ordered(taskId: string): TaskPlanEdge[] {
    const edges = edgesByTask.get(taskId) ?? [];
    return RELATION_ORDER.flatMap((relation) =>
      edges.filter((edge) => edge.relation === relation),
    );
  }

  function walk(taskId: string, depth: number, path: ReadonlySet<string>) {
    for (const edge of ordered(taskId)) {
      if (items.length >= TASK_PLAN_MAX_ITEMS) {
        truncated = true;
        return;
      }
      const id = edge.peer.id;
      const loops = path.has(id);
      const expand =
        !loops &&
        depth < TASK_PLAN_MAX_DEPTH &&
        depth < (expandedAt.get(id) ?? Number.POSITIVE_INFINITY);
      const repeat = loops
        ? "loops_back"
        : shown.has(id) && !expand
          ? "shown_above"
          : null;
      items.push({
        depth,
        relation: edge.relation,
        task: edge.peer,
        repeat,
        hasMore: repeat === null && !expand && ordered(id).length > 0,
      });
      shown.add(id);
      if (expand) {
        expandedAt.set(id, depth);
        walk(id, depth + 1, new Set(path).add(id));
      }
    }
  }

  walk(rootId, 1, new Set([rootId]));
  return { items, truncated };
}
