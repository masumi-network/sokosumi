import type { Task } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";

import { isReadOnlyForViewer } from "@/app/tasks/utils/task-read-only";
import {
  SUBTASK_LIST_LIMIT,
  toSubtaskRow,
} from "@/app/tasks/utils/task-subtask-row";
import { taskService } from "@/lib/services/task.service";
import { TaskSubtaskList } from "./task-subtask-list";

/** The Task's sub-task checklist. A failed read hides the section. */
export async function TaskSubtaskSection({
  task,
  hasAssignedSeatPromise,
}: {
  task: Task;
  hasAssignedSeatPromise: Promise<boolean>;
}) {
  const [listed, hasAssignedSeat, tTasks] = await Promise.all([
    taskService
      .listTasks({ parentTaskId: task.id, limit: SUBTASK_LIST_LIMIT })
      .catch(() => null),
    hasAssignedSeatPromise,
    getTranslations("App.Tasks"),
  ]);
  if (!listed) return null;
  const readOnly = isReadOnlyForViewer({
    forceReadOnly: false,
    taskStatus: task.status,
    hasAssignedSeat,
  });
  // Nothing to show and nothing the reader may add.
  if (readOnly && listed.tasks.length === 0) return null;

  return (
    <TaskSubtaskList
      parentTaskId={task.id}
      initialRows={listed.tasks.map((child) =>
        toSubtaskRow(child, tTasks("personalAssistant")),
      )}
      readOnly={readOnly}
    />
  );
}
