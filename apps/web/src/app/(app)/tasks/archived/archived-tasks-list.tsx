"use client";

import type { TaskStatus } from "@sokosumi/core-client";
import { Archive } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { unmarkTaskArchived } from "@/app/tasks/utils/archived-task-ids";
import { taskHref } from "@/app/tasks/utils/task-href";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { taskClientService } from "@/lib/services/task.client";
import { cn } from "@/lib/utils";

export interface ArchivedTaskRow {
  id: string;
  identifier: string | null;
  name: string;
  status: TaskStatus;
  /** Project name; null when the Task has none. */
  project: string | null;
  /** Archive date, already formatted for the viewer. */
  archivedOn: string | null;
}

export function ArchivedTasksList({
  tasks,
  query,
}: {
  tasks: ArchivedTaskRow[];
  /** The search that produced `tasks`, if any. */
  query?: string;
}) {
  const t = useTranslations("App.Tasks.Archived");
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const router = useRouter();
  const [rows, setRows] = useState(tasks);
  // Several restores can run at once. A row stays in place until its answer:
  // a row that left on click would put the next Restore under the pointer.
  const [restoringIds, setRestoringIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  async function handleRestore(task: ArchivedTaskRow) {
    setRestoringIds((current) => new Set(current).add(task.id));
    try {
      await taskClientService.restore(task.id);
      // The board hides ids archived in this tab; let it show this one again.
      unmarkTaskArchived(task.id);
      setRows((current) => current.filter((row) => row.id !== task.id));
      toast.success(t("restored", { name: task.name }), {
        action: {
          label: t("open"),
          onClick: () => router.push(taskHref(task)),
        },
      });
      router.refresh();
    } catch {
      toast.error(t("restoreError"));
    } finally {
      setRestoringIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  return (
    <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
          <Archive className="text-muted-foreground size-6" aria-hidden />
          <p className="text-muted-foreground max-w-sm text-sm text-pretty wrap-anywhere">
            {query ? t("noMatches", { query }) : t("empty")}
          </p>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground px-2 pt-1 text-xs">
            {t("draftNote")}
          </p>
          <ul className="flex flex-col gap-2">
            {rows.map((task) => (
              <li
                key={task.id}
                className={cn(
                  HOLDER_ITEM_CLASS,
                  "flex items-center gap-3 px-3 py-2",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <Link
                      href={`/tasks/archived/${task.id}`}
                      className="flex min-w-0 items-baseline gap-2 text-sm font-medium hover:underline"
                    >
                      {task.identifier ? (
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {task.identifier}
                        </span>
                      ) : null}
                      <span className="truncate">{task.name}</span>
                    </Link>
                    <TaskStatusBadge
                      status={task.status}
                      label={tStatus(task.status)}
                      className="w-fit rounded-sm"
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {task.project ?? t("noProject")}
                    {task.archivedOn
                      ? ` · ${t("archivedOn", { date: task.archivedOn })}`
                      : null}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  loading={restoringIds.has(task.id)}
                  onClick={() => handleRestore(task)}
                  aria-label={t("restoreNamed", { name: task.name })}
                >
                  {t("restore")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
