"use client";

import type { TaskStatus } from "@sokosumi/core-client";
import { Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useTableCopy } from "@/app/drive/tables/use-table-copy";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { tasksTablePlan } from "@/app/tasks/utils/tasks-table-plan";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** The toasts carry the way to the new Table or how to finish it: they stay until dismissed. */
const STAY = { duration: Infinity, closeButton: true };

/**
 * Copies the Tasks the board shows into a new Files Table, a snapshot that does not follow the Tasks. Before it
 * copies, it says how many Tasks go in and that Tasks matching the filters but not loaded stay out.
 */
export function TasksTableCopy({
  tasks,
  notLoaded,
  projectId,
  statusLabels,
}: {
  /** The Tasks on the board now, under its filters. */
  tasks: TaskWithCoworker[];
  /** Matching Tasks past the loaded pages: a count on the board, unknown in the list. */
  notLoaded: number | "unknown";
  /** The board's project filter: the Table joins that project. */
  projectId: string | null;
  statusLabels: Record<TaskStatus, string>;
}) {
  const t = useTranslations("App.Tasks.TableCopy");
  const format = useFormatter();
  const router = useRouter();
  const { pending, copy } = useTableCopy();
  const [open, setOpen] = useState(false);
  const count = tasks.filter((task) => !task.isPending).length;

  async function handleCopy() {
    try {
      const { id, rows } = await copy(() => {
        const now = new Date();
        return tasksTablePlan(
          tasks,
          {
            labels: {
              columns: {
                name: t("columns.name"),
                status: t("columns.status"),
                assignee: t("columns.assignee"),
                project: t("columns.project"),
                due: t("columns.due"),
                tags: t("columns.tags"),
                link: t("columns.link"),
              },
              statuses: statusLabels,
            },
            source: {
              title: t("tableTitle", {
                date: format.dateTime(now, { dateStyle: "medium" }),
              }),
              description: t("tableDescription", {
                date: format.dateTime(now, "dateTimeMedium"),
              }),
              projectId,
            },
            origin: window.location.origin,
          },
          crypto.randomUUID(),
        );
      });
      setOpen(false);
      toast.success(t("copied", { count: rows }), {
        ...STAY,
        action: {
          label: t("openTable"),
          onClick: () => router.push(`/drive/tables/${id}`),
        },
      });
    } catch {
      toast.error(t("failed"), STAY);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label={t("button")}
        >
          <Table2 className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t("button")}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("description", { count })}
          </AlertDialogDescription>
          {notLoaded === "unknown" ? (
            <p className="text-muted-foreground text-sm">
              {t("notLoadedUnknown")}
            </p>
          ) : notLoaded > 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("notLoaded", { count: notLoaded })}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!count}
            loading={pending}
            onClick={(event) => {
              // Stays open until the copy is done, so a failure can be retried here.
              event.preventDefault();
              void handleCopy();
            }}
          >
            {t("copy", { count })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
