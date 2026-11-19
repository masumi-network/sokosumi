"use client";

import { TaskPriority, TaskStatus } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { exportTasks, previewTasksExport } from "@/app/tasks/actions";
import {
  TASKS_EXPORT_LIMIT,
  type TasksCsvLabels,
  tasksCsv,
} from "@/app/tasks/utils/tasks-csv";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ExportFilters = Parameters<typeof exportTasks>[0];

interface TasksExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The filters and sort on screen; the file holds the same Tasks. */
  filters: ExportFilters;
  /** The view and filters in effect, each named for a reader. */
  activeFilters: string[];
  sortLabel: string;
  onCloseAutoFocus?: (event: Event) => void;
}

function download(csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  // Safari cancels a download whose URL is revoked in the same task.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function useCsvLabels(): TasksCsvLabels {
  const t = useTranslations("App.Tasks.Export.columns");
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const tPriority = useTranslations("App.Tasks.Priority.levels");
  return {
    columns: {
      identifier: t("identifier"),
      name: t("name"),
      status: t("status"),
      priority: t("priority"),
      assignee: t("assignee"),
      owner: t("owner"),
      project: t("project"),
      dueOn: t("dueOn"),
      createdAt: t("createdAt"),
      updatedAt: t("updatedAt"),
    },
    status: Object.fromEntries(
      Object.values(TaskStatus).map((status) => [status, tStatus(status)]),
    ) as TasksCsvLabels["status"],
    priority: Object.fromEntries(
      Object.values(TaskPriority).map((level) => [level, tPriority(level)]),
    ) as TasksCsvLabels["priority"],
  };
}

/**
 * Asks before Export as CSV downloads: how many Tasks match, which view and
 * filters chose them, and a few example rows. Opening reads one small page;
 * the full export runs only on Export.
 */
export function TasksExportDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  ...props
}: TasksExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <TasksExportSummary
          {...props}
          open={open}
          onExported={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TasksExportSummary({
  open,
  filters,
  activeFilters,
  sortLabel,
  onExported,
}: Omit<TasksExportDialogProps, "onOpenChange" | "onCloseAutoFocus"> & {
  onExported: () => void;
}) {
  const t = useTranslations("App.Tasks.Export");
  const labels = useCsvLabels();
  // Mounted while the dialog shows and dropped once it has animated out,
  // so each later open counts again.
  const preview = useQuery({
    queryKey: ["tasks-export-preview", filters],
    queryFn: () => previewTasksExport(filters),
    retry: false,
    gcTime: 0,
  });
  const [isExporting, startExport] = useTransition();
  // Cancel closes the dialog but cannot stop the action. Closing, or
  // unmounting while open, starts a new run, and an export from an earlier
  // run saves nothing. The content stays mounted while it animates out.
  const run = useRef(0);
  useEffect(() => {
    const wasOpen = open;
    return () => {
      if (wasOpen) run.current += 1;
    };
  }, [open]);
  const handleExport = () => {
    const started = run.current;
    startExport(async () => {
      try {
        const { rows } = await exportTasks(filters);
        if (run.current !== started) return;
        download(tasksCsv(rows, labels));
        onExported();
      } catch {
        if (run.current === started) toast.error(t("error"));
      }
    });
  };
  const rows = preview.data?.rows ?? [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <ul aria-label={t("filtersLabel")} className="flex flex-wrap gap-1.5">
        {[...activeFilters, t("sortChip", { sort: sortLabel })].map((name) => (
          <li key={name} className="bg-muted rounded-full px-2.5 py-1 text-xs">
            {name}
          </li>
        ))}
      </ul>
      <div aria-live="polite" className="space-y-1 text-sm">
        {preview.isPending ? (
          <p className="text-muted-foreground">{t("counting")}</p>
        ) : preview.isError ? (
          <p className="text-destructive">{t("countError")}</p>
        ) : (
          <>
            <p className="font-medium">
              {t("count", { count: preview.data.matched })}
            </p>
            {preview.data.matched > TASKS_EXPORT_LIMIT ? (
              <p className="text-muted-foreground">
                {t("truncated", { limit: TASKS_EXPORT_LIMIT })}
              </p>
            ) : null}
          </>
        )}
      </div>
      {rows.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-1 rounded-sm text-sm outline-none focus-visible:ring-2">
            <ChevronRight
              className="size-4 transition-transform group-data-[state=open]:rotate-90"
              aria-hidden
            />
            {t("preview")}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 overflow-x-auto rounded-md border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{labels.columns.name}</TableHead>
                  <TableHead>{labels.columns.status}</TableHead>
                  <TableHead>{labels.columns.assignee}</TableHead>
                  <TableHead>{labels.columns.dueOn}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  // Rows carry no id, and the preview never reorders.
                  <TableRow key={index}>
                    <TableCell className="max-w-48 truncate">
                      {row.name}
                    </TableCell>
                    <TableCell>{labels.status[row.status]}</TableCell>
                    <TableCell>{row.assignee}</TableCell>
                    <TableCell>{row.dueOn}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{t("cancel")}</Button>
        </DialogClose>
        <Button
          disabled={!preview.data?.matched}
          loading={preview.isPending || isExporting}
          onClick={handleExport}
        >
          {t("confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
