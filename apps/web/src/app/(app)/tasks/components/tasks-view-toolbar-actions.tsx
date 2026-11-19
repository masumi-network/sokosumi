"use client";

import { Archive, Download } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ComponentProps, useState } from "react";
import type { exportTasks } from "@/app/tasks/actions";
import { Button } from "@/components/ui/button";
import { PopoverClose } from "@/components/ui/popover";

import { TasksExportDialog } from "./tasks-export-dialog";
import { TasksViewFilters } from "./tasks-view-filters";
import { ViewModeSwitch, type ViewModeSwitchProps } from "./view-mode-switch";

interface TasksViewToolbarActionsProps {
  filters: Omit<ComponentProps<typeof TasksViewFilters>, "display">;
  display: ViewModeSwitchProps;
  /** The filters and sort on screen, which Export as CSV exports. */
  exportFilters: Parameters<typeof exportTasks>[0];
}

/**
 * The Tasks tab toolbar: the view switcher leads, and the Filters menu and
 * the view options menu take the right edge. Archived Tasks are another
 * way to see Tasks, so their link lives in the view options menu. New task
 * is the sidebar header's action; below md the create FAB covers creation.
 */
export function TasksViewToolbarActions({
  filters,
  display,
  exportFilters,
}: TasksViewToolbarActionsProps) {
  const t = useTranslations("App.Tasks.Archived");
  const tExport = useTranslations("App.Tasks.Export");
  // Outside the menu: closing the menu must not close the dialog.
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <TasksViewFilters
      {...filters}
      display={(activeFilters) => (
        <>
          <ViewModeSwitch {...display}>
            <PopoverClose asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 px-2"
                onClick={() => setExportOpen(true)}
              >
                <Download className="size-4" aria-hidden />
                {tExport("button")}
              </Button>
            </PopoverClose>
            <PopoverClose asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 px-2"
                asChild
              >
                <Link href="/tasks/archived">
                  <Archive className="size-4" aria-hidden />
                  {t("link")}
                </Link>
              </Button>
            </PopoverClose>
          </ViewModeSwitch>
          <TasksExportDialog
            open={exportOpen}
            onOpenChange={setExportOpen}
            filters={exportFilters}
            activeFilters={activeFilters}
            sortLabel={display.labels.sortOptions[display.sort]}
          />
        </>
      )}
    />
  );
}
