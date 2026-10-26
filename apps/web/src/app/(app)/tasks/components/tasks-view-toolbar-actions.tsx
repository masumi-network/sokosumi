"use client";

import type { ComponentProps } from "react";

import { NewTaskButton } from "@/app/components/new-task-button.client";

import { TasksViewFilters } from "./tasks-view-filters";
import { ViewModeSwitch, type ViewModeSwitchProps } from "./view-mode-switch";

interface TasksViewToolbarActionsProps {
  filters: ComponentProps<typeof TasksViewFilters>;
  display: ViewModeSwitchProps;
}

/** Right side of the Tasks tab toolbar: filters, display and New task. */
export function TasksViewToolbarActions({
  filters,
  display,
}: TasksViewToolbarActionsProps) {
  return (
    <>
      <TasksViewFilters {...filters} />
      <ViewModeSwitch {...display} />
      {/* Below md the create FAB covers creation. */}
      <NewTaskButton className="hidden md:inline-flex" />
    </>
  );
}
