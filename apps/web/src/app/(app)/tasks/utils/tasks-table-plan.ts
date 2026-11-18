import type { TaskStatus } from "@sokosumi/core-client";
import { createDataTableSchema } from "@sokosumi/utils";
import { tableImportBatches } from "@/app/drive/tables/table-import";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { taskHref } from "./task-href";

type Column =
  | "name"
  | "status"
  | "assignee"
  | "project"
  | "due"
  | "tags"
  | "link";
/** A select column holds at most this many options; past it, tags stay plain text. */
const MAX_OPTIONS = 100;

/**
 * The Tasks a workspace Table may hold. Everyone in the workspace can read its Tables, but only the owner can read
 * a private Task, so private Tasks stay out. A Task still being created has no page to link and stays out too.
 */
export function sharedTasks(tasks: TaskWithCoworker[]) {
  return tasks.filter(
    (task) => !task.isPending && task.visibility !== "PRIVATE",
  );
}

/**
 * The Tasks on the board as a new Files Table: the create request and every row in batches of at most 100, keyed
 * by `key`, so a retry with the same plan creates and inserts nothing twice. A snapshot: the Table does not follow
 * the Tasks. Only {@link sharedTasks} go in. An empty cell stays empty.
 */
export function tasksTablePlan(
  tasks: TaskWithCoworker[],
  {
    labels,
    source,
    origin,
  }: {
    labels: {
      columns: Record<Column, string>;
      statuses: Partial<Record<TaskStatus, string>>;
    };
    source: { title: string; description: string; projectId: string | null };
    /** The app's origin: a URL column keeps only full web addresses. */
    origin: string;
  },
  key: string,
) {
  const copied = sharedTasks(tasks);
  const status = (task: TaskWithCoworker) =>
    labels.statuses[task.status] ?? task.status;
  const tags = (task: TaskWithCoworker) =>
    (task.workspaceTags ?? []).map((tag) => tag.displayName);
  const sorted = (values: string[]) => [...new Set(values)].sort();
  const tagOptions = sorted(copied.flatMap(tags));
  const tagsAsText = tagOptions.length > MAX_OPTIONS;

  const columns: {
    key: Column;
    type: "text" | "single_select" | "multiple_select" | "date" | "url";
    options?: string[];
  }[] = [
    { key: "name", type: "text" },
    {
      key: "status",
      type: "single_select",
      options: sorted(copied.map(status)),
    },
    { key: "assignee", type: "text" },
    { key: "project", type: "text" },
    { key: "due", type: "date" },
    tagsAsText
      ? { key: "tags", type: "text" }
      : { key: "tags", type: "multiple_select", options: tagOptions },
    { key: "link", type: "url" },
  ];
  const ids = columns.map(() => crypto.randomUUID());
  const table = createDataTableSchema.parse({
    key,
    ...source,
    columns: columns.map(({ key, ...column }, i) => ({
      id: ids[i],
      name: labels.columns[key],
      ...column,
    })),
  });

  const insert = copied.map((task) => {
    const taskTags = tags(task);
    const cells: Record<Column, string | string[] | null> = {
      name: task.name,
      status: status(task),
      assignee: task.assignee?.name ?? null,
      project: task.project?.name ?? null,
      due: task.dueOn ?? null,
      tags: !taskTags.length
        ? null
        : tagsAsText
          ? taskTags.join(", ")
          : taskTags,
      link: `${origin}${taskHref(task)}`,
    };
    return {
      values: Object.fromEntries(
        columns.flatMap(({ key }, i) =>
          cells[key] === null ? [] : [[ids[i], cells[key]]],
        ),
      ),
      evidence: {},
    };
  });
  return { table, batches: tableImportBatches(key, insert) };
}
