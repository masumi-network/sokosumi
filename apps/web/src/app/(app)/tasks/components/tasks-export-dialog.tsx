"use client";

import { TaskPriority, TaskStatus } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { exportTasks } from "@/app/tasks/actions";
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

/** Enough rows to show what the file looks like. */
const PREVIEW_ROWS = 3;

type ExportFilters = Parameters<typeof exportTasks>[0];

interface TasksExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The filters and sort on screen; the file holds the same Tasks. */
  filters: ExportFilters;
  /** The view and filters in effect, each named for a reader. */
  activeFilters: string[];
  sortLabel: string;
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
 * filters chose them, and a few example rows. Export saves the rows it
 * counted, so the file holds what the dialog said.
 */
export function TasksExportDialog({
  open,
  onOpenChange,
  ...props
}: TasksExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <TasksExportSummary {...props} onExported={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TasksExportSummary({
  filters,
  activeFilters,
  sortLabel,
  onExported,
}: Omit<TasksExportDialogProps, "open" | "onOpenChange"> & {
  onExported: () => void;
}) {
  const t = useTranslations("App.Tasks.Export");
  const labels = useCsvLabels();
  // Mounted only while the dialog is open, and dropped on close, so each
  // open counts again.
  const exported = useQuery({
    queryKey: ["tasks-export", filters],
    queryFn: () => exportTasks(filters),
    retry: false,
    gcTime: 0,
  });
  const preview = exported.data?.rows.slice(0, PREVIEW_ROWS) ?? [];

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
        {exported.isPending ? (
          <p className="text-muted-foreground">{t("counting")}</p>
        ) : exported.isError ? (
          <p className="text-destructive">{t("error")}</p>
        ) : (
          <>
            <p className="font-medium">
              {t("count", { count: exported.data.matched })}
            </p>
            {exported.data.truncated ? (
              <p className="text-muted-foreground">
                {t("truncated", { limit: TASKS_EXPORT_LIMIT })}
              </p>
            ) : null}
          </>
        )}
      </div>
      {preview.length > 0 ? (
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
                {preview.map((row, index) => (
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
          disabled={!exported.data || exported.data.rows.length === 0}
          loading={exported.isPending}
          onClick={() => {
            if (!exported.data) return;
            download(tasksCsv(exported.data.rows, labels));
            onExported();
          }}
        >
          {t("confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
