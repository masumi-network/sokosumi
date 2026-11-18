"use client";

import type { TaskStatus } from "@sokosumi/core-client";
import { Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useTableCopy } from "@/app/drive/tables/use-table-copy";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import {
  sharedTasks,
  tasksTablePlan,
} from "@/app/tasks/utils/tasks-table-plan";
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
 * copies, it says how many Tasks go in and which stay out: private ones, and ones matching the filters but not
 * loaded. After a failure it offers to finish that copy, the Tasks confirmed then, or to start over, leaving any
 * partial Table in Files. The copy is bound to the workspace it was confirmed in: a switch writes nothing more.
 */
export function TasksTableCopy({
  tasks,
  notLoaded,
  projectId,
  statusLabels,
  workspace,
}: {
  /** The Tasks on the board now, under its filters. */
  tasks: TaskWithCoworker[];
  /** Matching Tasks past the loaded pages: a count on the board, unknown in the list. */
  notLoaded: number | "unknown";
  /** The board's project filter: the Table joins that project. */
  projectId: string | null;
  statusLabels: Record<TaskStatus, string>;
  /** The board's workspace: an organization id, or `personal`. */
  workspace: string;
}) {
  const t = useTranslations("App.Tasks.TableCopy");
  const format = useFormatter();
  const router = useRouter();
  const { pending, unfinished, copy, discard } = useTableCopy(workspace);
  const [open, setOpen] = useState(false);
  const count = sharedTasks(tasks).length;
  const privateCount = tasks.filter(
    (task) => !task.isPending && task.visibility === "PRIVATE",
  ).length;
  // One description, so a screen reader hears every Task that stays out along with the count.
  const description = unfinished
    ? [
        t("resume", { count: unfinished.rows, title: unfinished.title }),
        t(unfinished.tableCreated ? "startOverPartial" : "startOver"),
      ].join(" ")
    : [
        t("description", { count }),
        privateCount ? t("private", { count: privateCount }) : null,
        notLoaded === "unknown"
          ? t("notLoadedUnknown")
          : notLoaded > 0
            ? t("notLoaded", { count: notLoaded })
            : null,
      ]
        .filter(Boolean)
        .join(" ");

  async function handleCopy() {
    try {
      const copied = await copy(() => {
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
      // The workspace changed while it ran: its outcome belongs to the other workspace.
      if (!copied) return;
      const { id, rows } = copied;
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
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("cancel")}
          </AlertDialogCancel>
          {unfinished ? (
            <Button variant="outline" disabled={pending} onClick={discard}>
              {t("startOverButton")}
            </Button>
          ) : null}
          <AlertDialogAction
            disabled={!unfinished && !count}
            loading={pending}
            onClick={(event) => {
              // Stays open until the copy is done, so a failure can be retried here.
              event.preventDefault();
              void handleCopy();
            }}
          >
            {unfinished ? t("finish") : t("copy", { count })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
