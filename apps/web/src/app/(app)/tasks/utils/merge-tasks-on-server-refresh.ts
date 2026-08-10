import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

interface MergeTasksOnServerRefreshParams {
  prev: TaskWithCoworker[];
  serverTasks: TaskWithCoworker[];
  pendingMoveTaskIds: ReadonlySet<string>;
  /**
   * Board load-more keeps rows outside the refreshed first page.
   * List view must drop them — `updatedAt` order invalidates advanced cursors.
   */
  keepLocalOnlyTasks: boolean;
}

/**
 * Merge a server tasks refresh into client list/board state.
 * Preserves optimistic drag status while a move is in flight.
 */
export function mergeTasksOnServerRefresh({
  prev,
  serverTasks,
  pendingMoveTaskIds,
  keepLocalOnlyTasks,
}: MergeTasksOnServerRefreshParams): TaskWithCoworker[] {
  const prevById = new Map(prev.map((task) => [task.id, task]));
  const next = serverTasks.map((task) => {
    if (pendingMoveTaskIds.has(task.id)) {
      const localTask = prevById.get(task.id);
      if (localTask) return localTask;
    }
    return task;
  });

  if (!keepLocalOnlyTasks) {
    return next;
  }

  const nextIds = new Set(serverTasks.map((task) => task.id));
  for (const task of prev) {
    if (!nextIds.has(task.id)) {
      next.push(task);
    }
  }

  return next;
}
