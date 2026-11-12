import type {
  KanbanColumnDefinition,
  KanbanColumnId,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";

export function appendUniqueTasks(
  prevTasks: TaskWithCoworker[],
  newTasks: TaskWithCoworker[],
) {
  const existingIds = new Set(prevTasks.map((task) => task.id));
  const uniqueNewTasks = newTasks.filter((task) => !existingIds.has(task.id));
  return [...prevTasks, ...uniqueNewTasks];
}

export function buildInitialColumnCursorById(
  columns: KanbanColumnDefinition[],
  initialColumnNextCursorById: Record<KanbanColumnId, string | null>,
): Record<KanbanColumnId, string | null> {
  return columns.reduce(
    (acc, column) => {
      acc[column.id] = initialColumnNextCursorById[column.id] ?? null;
      return acc;
    },
    {} as Record<KanbanColumnId, string | null>,
  );
}
