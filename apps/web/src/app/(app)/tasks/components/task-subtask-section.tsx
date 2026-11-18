import type { Task } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";

import { isReadOnlyForViewer } from "@/app/tasks/utils/task-read-only";
import {
  MAX_SUBTASK_DEPTH,
  SUBTASK_LIST_LIMIT,
  toSubtaskRow,
} from "@/app/tasks/utils/task-subtask-row";
import { taskService } from "@/lib/services/task.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { TaskSubtaskList } from "./task-subtask-list";

/**
 * The Task's sub-task checklist. A failed read hides the section, and so does
 * a Task with no sub-tasks: the "⋯" menu adds the first one.
 */
export async function TaskSubtaskSection({
  task,
  hasAssignedSeatPromise,
  assigneeOptionsPromise,
}: {
  task: Task;
  hasAssignedSeatPromise: Promise<boolean>;
  assigneeOptionsPromise: Promise<CoworkerOption[]>;
}) {
  const [listed, hasAssignedSeat, assigneeOptions, tTasks] = await Promise.all([
    taskService
      .listTasks({ parentTaskId: task.id, limit: SUBTASK_LIST_LIMIT })
      .catch(() => null),
    hasAssignedSeatPromise,
    assigneeOptionsPromise,
    getTranslations("App.Tasks"),
  ]);
  if (!listed || listed.tasks.length === 0) return null;
  const renderedAt = Date.now();
  const readOnly = isReadOnlyForViewer({
    forceReadOnly: false,
    taskStatus: task.status,
    hasAssignedSeat,
  });
  // A new sub-task's level is this Task's chain length.
  const canAdd = (task.ancestors?.length ?? 0) < MAX_SUBTASK_DEPTH;

  return (
    <TaskSubtaskList
      parentTaskId={task.id}
      initialRows={listed.tasks.map((child) =>
        toSubtaskRow(child, tTasks("personalAssistant")),
      )}
      renderedAt={renderedAt}
      readOnly={readOnly}
      canAdd={canAdd}
      assigneeOptions={assigneeOptions}
      progress={task.subtaskProgress}
    />
  );
}
