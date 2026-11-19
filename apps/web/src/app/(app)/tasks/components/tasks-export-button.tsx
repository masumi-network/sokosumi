"use client";

import { TaskPriority, TaskStatus } from "@sokosumi/core-client";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { exportTasks } from "@/app/tasks/actions";
import {
  TASKS_EXPORT_LIMIT,
  type TasksCsvLabels,
  tasksCsv,
} from "@/app/tasks/utils/tasks-csv";
import { Button } from "@/components/ui/button";

interface TasksExportButtonProps {
  /** The filters and sort on screen; the file holds the same Tasks. */
  filters: Parameters<typeof exportTasks>[0];
}

function download(csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export as CSV in the view options menu. The hint under it says what the
 * file holds: the Tasks the current filters match, up to the export limit.
 */
export function TasksExportButton({ filters }: TasksExportButtonProps) {
  const t = useTranslations("App.Tasks.Export");
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const tPriority = useTranslations("App.Tasks.Priority.levels");
  const [isPending, startTransition] = useTransition();

  const labels = (): TasksCsvLabels => ({
    columns: {
      identifier: t("columns.identifier"),
      name: t("columns.name"),
      status: t("columns.status"),
      priority: t("columns.priority"),
      assignee: t("columns.assignee"),
      owner: t("columns.owner"),
      project: t("columns.project"),
      dueOn: t("columns.dueOn"),
      createdAt: t("columns.createdAt"),
      updatedAt: t("columns.updatedAt"),
    },
    status: Object.fromEntries(
      Object.values(TaskStatus).map((status) => [status, tStatus(status)]),
    ) as TasksCsvLabels["status"],
    priority: Object.fromEntries(
      Object.values(TaskPriority).map((level) => [level, tPriority(level)]),
    ) as TasksCsvLabels["priority"],
  });

  const handleExport = () => {
    startTransition(async () => {
      try {
        const { rows, truncated } = await exportTasks(filters);
        download(tasksCsv(rows, labels()));
        if (truncated) {
          toast.info(t("truncated", { limit: TASKS_EXPORT_LIMIT }));
        }
      } catch {
        toast.error(t("error"));
      }
    });
  };

  return (
    <div className="space-y-1">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2"
        loading={isPending}
        onClick={handleExport}
      >
        <Download className="size-4" aria-hidden />
        {t("button")}
      </Button>
      <p className="text-muted-foreground px-2 text-xs">
        {t("hint", { limit: TASKS_EXPORT_LIMIT })}
      </p>
    </div>
  );
}
