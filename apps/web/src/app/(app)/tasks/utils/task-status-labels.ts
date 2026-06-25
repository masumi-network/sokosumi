import { type TaskStatus } from "@sokosumi/utils";

import {
  TASK_STATUS_DISPLAY_ORDER,
  type TaskStatusLabelKey,
} from "@/lib/utils/task-status-order";

export type { TaskStatusLabelKey };

function buildTaskStatusLabelRecord(
  translate: (key: TaskStatusLabelKey) => string,
): Record<TaskStatus, string> {
  const labels = {} as Record<TaskStatus, string>;

  for (const status of TASK_STATUS_DISPLAY_ORDER) {
    labels[status] = translate(status);
  }

  return labels;
}

export function buildTaskStatusLabels(
  translate: (key: TaskStatusLabelKey) => string,
): Record<TaskStatus, string> {
  return buildTaskStatusLabelRecord(translate);
}

export function buildTaskStatusAbbreviationLabels(
  translate: (key: TaskStatusLabelKey) => string,
): Record<TaskStatus, string> {
  return buildTaskStatusLabelRecord(translate);
}
