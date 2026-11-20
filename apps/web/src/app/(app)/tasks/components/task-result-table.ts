import { type Task, TaskVisibility } from "@sokosumi/core-client";
import { createDataTableSchema, tableInsertRowSchema } from "@sokosumi/utils";
import {
  isNumericCsvColumn,
  tableImportBatches,
} from "@/app/drive/tables/table-import";

const MAX_COLUMNS = 100;
const NAME_MAX = 100;
const TITLE_MAX = 160;
const CELL_MAX = 20000;

/** A table a Files Table cannot hold whole: more columns, a longer column name or cell, or a row over 1 MB. */
export class TaskResultTableTooLarge extends Error {}

/**
 * Where a Task's tables may be saved: a Table is read by the whole workspace, so a private Task in an
 * organization offers nothing. Its result would reach members who cannot open the Task.
 */
export function taskTableSource(
  task: Pick<Task, "name" | "projectId" | "visibility" | "organizationId">,
) {
  if (task.organizationId && task.visibility === TaskVisibility.PRIVATE)
    return undefined;
  return { title: task.name, projectId: task.projectId };
}

/**
 * A table from a Task's activity, as the reader sees it (header row first), planned as a new Files Table:
 * the create request and its rows in keyed batches, so a retry with the same plan saves nothing twice.
 * A column turns Number only when every value converts without loss; codes, amounts with symbols and
 * anything else ambiguous stay Text, exactly as written. Throws `TaskResultTableTooLarge` rather than
 * drop or cut anything.
 */
export function taskResultTablePlan(
  cells: string[][],
  source: { title: string; description: string; projectId: string | null },
  untitled: (position: number) => string,
  key: string,
) {
  const [header = [], ...body] = cells;
  const rows = body.filter((row) => row.some((cell) => cell.trim()));
  if (
    header.length > MAX_COLUMNS ||
    header.some((name) => name.trim().length > NAME_MAX) ||
    rows.some(
      (row) =>
        row.length > MAX_COLUMNS ||
        row.some((cell) => cell.trim().length > CELL_MAX),
    )
  )
    throw new TaskResultTableTooLarge();
  const columns = header.map((raw, i) => {
    const name = raw.trim() || untitled(i + 1);
    return {
      id: crypto.randomUUID(),
      name,
      type: isNumericCsvColumn(
        name,
        rows.map((row) => row[i] ?? ""),
      )
        ? ("number" as const)
        : ("text" as const),
    };
  });
  const table = createDataTableSchema.parse({
    key,
    ...source,
    title: source.title.slice(0, TITLE_MAX),
    columns,
  });
  const insert = rows.map((row) =>
    tableInsertRowSchema.parse({
      values: Object.fromEntries(
        columns.flatMap(({ id, type }, i) => {
          const value = row[i]?.trim() ?? "";
          if (!value) return [];
          return [[id, type === "number" ? Number(value) : value]];
        }),
      ),
    }),
  );
  try {
    return { table, batches: tableImportBatches(key, insert) };
  } catch {
    // One row over the 1 MB request limit.
    throw new TaskResultTableTooLarge();
  }
}
