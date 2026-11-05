import type { ProjectStatsEntry } from "@sokosumi/core-client";
import Link from "next/link";
import type { KanbanColumnId } from "@/app/tasks/types/task-board";
import { COLUMN_TASK_STATUSES } from "@/app/tasks/utils/task-column";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import { WORKSPACE_COLUMN_FOCUS_RING } from "./workspace-column-row";

/** Each count is one column of the Tasks board, by the board's own statuses. */
const STRIP_COLUMNS = {
  running: "in-progress",
  waiting: "input-required",
  done: "done",
} as const satisfies Record<string, KanbanColumnId>;

type StripCount = keyof typeof STRIP_COLUMNS;

/**
 * The strip's three task counts, each the number the project's Tasks board
 * shows in that column.
 */
export function projectTaskCounts(
  tasks: ProjectStatsEntry["tasks"],
): Record<StripCount, number> {
  const columnCount = (column: KanbanColumnId) =>
    tasks.byStatus
      .filter((row) => COLUMN_TASK_STATUSES[column].includes(row.status))
      .reduce((sum, row) => sum + row.count, 0);

  return {
    running: columnCount(STRIP_COLUMNS.running),
    waiting: columnCount(STRIP_COLUMNS.waiting),
    done: columnCount(STRIP_COLUMNS.done),
  };
}

interface ProjectStatusStripProps {
  projectId: string;
  counts: ReturnType<typeof projectTaskCounts>;
  /** Formats a count in the reader's locale. */
  formatCount: (value: number) => string;
  labels: Record<StripCount | "label", string>;
}

/**
 * The top of Project Overview: Running, Waiting and Done task counts. Each
 * opens the project's Tasks board, where its column shows the same number.
 */
export function ProjectStatusStrip({
  projectId,
  counts,
  formatCount,
  labels,
}: ProjectStatusStripProps) {
  const href = `/tasks?${new URLSearchParams({ projectId }).toString()}`;
  const items = (Object.keys(STRIP_COLUMNS) as StripCount[]).map((key) => ({
    key,
    label: labels[key],
    value: counts[key],
  }));

  return (
    <section
      aria-label={labels.label}
      data-testid="project-status-strip"
      className={cn(HOLDER_CLASS, "grid grid-cols-3 gap-2")}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={href}
          data-testid={`project-status-${item.key}`}
          className={cn(
            HOLDER_ITEM_CLASS,
            HOLDER_ITEM_HOVER_CLASS,
            WORKSPACE_COLUMN_FOCUS_RING,
            "press flex min-w-0 flex-col justify-between gap-1 px-3 py-2.5 transition-colors",
          )}
        >
          <span className="text-muted-foreground text-xs font-medium break-words">
            {item.label}
          </span>
          <span
            className={cn(
              "text-2xl font-semibold tracking-tight tabular-nums",
              item.value === 0 && "text-muted-foreground",
            )}
          >
            {formatCount(item.value)}
          </span>
        </Link>
      ))}
    </section>
  );
}
