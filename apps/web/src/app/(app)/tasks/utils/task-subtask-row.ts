import type {
  Task,
  TaskListItem,
  TaskStatus,
  TaskSubtaskProgress,
} from "@sokosumi/core-client";
import type { TaskAssigneeView } from "@/app/tasks/types/task-board";
import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";
import { mapTaskAssignee } from "./task-view-model";

/** Core's page size cap; a checklist longer than this shows its first page. */
export const SUBTASK_LIST_LIMIT = 100;

/** Core's `LIMITS.MAX_SUBTASK_DEPTH`: levels of sub-tasks below a root Task. */
export const MAX_SUBTASK_DEPTH = 5;

/** One row of a Task's sub-task checklist. */
export interface SubtaskRow {
  id: string;
  identifier: string | null;
  name: string;
  status: TaskStatus;
  assignee: TaskAssigneeView | null;
  dueOn: string | null;
  subtaskProgress: TaskSubtaskProgress;
  /** A create request is on the wire: the row has no page and cannot move. */
  isPending?: boolean;
}

export function toSubtaskRow(
  task: Task | TaskListItem,
  personalAssistantFallback: string,
): SubtaskRow {
  return {
    id: task.id,
    identifier: task.identifier,
    name: stripInlineMarkdown(task.name),
    status: task.status,
    assignee: mapTaskAssignee(task, new Map(), personalAssistantFallback),
    dueOn: task.dueOn,
    subtaskProgress: task.subtaskProgress,
  };
}

/** A Coworker or Soko Bot runs the sub-task; a person or nobody does not. */
export function isAgentSubtask(row: SubtaskRow): boolean {
  return row.assignee !== null && row.assignee.kind !== "user";
}
