import { type ProjectStatsEntry, TaskStatus } from "@sokosumi/core-client";
import Link from "next/link";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import { WORKSPACE_COLUMN_FOCUS_RING } from "./workspace-column-row";

const SETTLED_TASK_STATUSES = new Set<string>([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
]);

/**
 * The strip's three task counts. Running and Waiting are one status each, the
 * one the Tasks link filters by, so a count always equals the rows it opens.
 * Open is every task that has not settled.
 */
export function projectTaskCounts(tasks: ProjectStatsEntry["tasks"]) {
  const count = (status: string) =>
    tasks.byStatus.find((row) => row.status === status)?.count ?? 0;
  const settled = tasks.byStatus
    .filter((row) => SETTLED_TASK_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row.count, 0);

  return {
    running: count(TaskStatus.RUNNING),
    waiting: count(TaskStatus.INPUT_REQUIRED),
    open: tasks.total - settled,
  };
}

interface ProjectStatusStripProps {
  projectId: string;
  counts: ReturnType<typeof projectTaskCounts>;
  /** Formats a count in the reader's locale. */
  formatCount: (value: number) => string;
  labels: { label: string; running: string; waiting: string; open: string };
}

/**
 * The top of Project Overview: Running, Waiting and Open task counts, each a
 * link to Tasks filtered to this project (and to that status).
 */
export function ProjectStatusStrip({
  projectId,
  counts,
  formatCount,
  labels,
}: ProjectStatusStripProps) {
  const tasksHref = (status?: TaskStatus) =>
    `/tasks?${new URLSearchParams({
      projectId,
      ...(status ? { status } : {}),
    }).toString()}`;
  const items = [
    {
      key: "running",
      label: labels.running,
      value: counts.running,
      href: tasksHref(TaskStatus.RUNNING),
    },
    {
      key: "waiting",
      label: labels.waiting,
      value: counts.waiting,
      href: tasksHref(TaskStatus.INPUT_REQUIRED),
    },
    {
      key: "open",
      label: labels.open,
      value: counts.open,
      href: tasksHref(),
    },
  ];

  return (
    <section
      aria-label={labels.label}
      data-testid="project-status-strip"
      className={cn(HOLDER_CLASS, "grid grid-cols-3 gap-2")}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
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
