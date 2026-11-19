import type { TaskPriority, TaskStatus } from "@sokosumi/core-client";
import { encodeTableCsv } from "@sokosumi/utils";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

/** The most Tasks one export holds. The menu tells the reader about it. */
export const TASKS_EXPORT_LIMIT = 1000;

/** Excel reads a CSV without it as the computer's legacy code page. */
const UTF8_BOM = "\uFEFF";

/** One exported Task: the fields of a row, before any label is applied. */
export interface TaskCsvRow {
  identifier: string | null;
  name: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  owner: string | null;
  project: string | null;
  dueOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TASK_CSV_COLUMNS = [
  "identifier",
  "name",
  "status",
  "priority",
  "assignee",
  "owner",
  "project",
  "dueOn",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof TaskCsvRow)[];

export interface TasksCsvLabels {
  columns: Record<(typeof TASK_CSV_COLUMNS)[number], string>;
  status: Record<TaskStatus, string>;
  priority: Record<TaskPriority, string>;
}

export function toTaskCsvRow(task: TaskWithCoworker): TaskCsvRow {
  return {
    identifier: task.identifier,
    name: task.name,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee?.name ?? null,
    owner: task.owner?.name ?? null,
    project: task.project?.name ?? null,
    dueOn: task.dueOn ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** A header row, then one line per Task, with status and priority named. */
export function tasksCsv(
  rows: readonly TaskCsvRow[],
  labels: TasksCsvLabels,
): string {
  const cell = (row: TaskCsvRow, column: (typeof TASK_CSV_COLUMNS)[number]) =>
    column === "status"
      ? labels.status[row.status]
      : column === "priority"
        ? labels.priority[row.priority]
        : row[column];
  return (
    UTF8_BOM +
    encodeTableCsv([
      TASK_CSV_COLUMNS.map((column) => labels.columns[column]),
      ...rows.map((row) => TASK_CSV_COLUMNS.map((column) => cell(row, column))),
    ])
  );
}
