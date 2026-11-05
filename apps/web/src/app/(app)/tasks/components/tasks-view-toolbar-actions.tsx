"use client";

import type { ComponentProps } from "react";

import { TasksViewFilters } from "./tasks-view-filters";
import { ViewModeSwitch, type ViewModeSwitchProps } from "./view-mode-switch";

interface TasksViewToolbarActionsProps {
  filters: ComponentProps<typeof TasksViewFilters>;
  display: ViewModeSwitchProps;
}

/**
 * Right side of the Tasks tab toolbar: filters and display. New task is the
 * sidebar header's action; below md the create FAB covers creation.
 */
export function TasksViewToolbarActions({
  filters,
  display,
}: TasksViewToolbarActionsProps) {
  return (
    <>
      <TasksViewFilters {...filters} />
      <ViewModeSwitch {...display} />
    </>
  );
}
