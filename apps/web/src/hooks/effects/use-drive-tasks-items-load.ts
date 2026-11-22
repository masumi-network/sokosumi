"use client";

import { useEffect } from "react";

/**
 * Triggers `DrivePageWorkspace`'s task-files listing loader whenever the Tasks
 * view is active or the loader dependencies change.
 */
export function useDriveTasksItemsLoad(
  isTasksView: boolean,
  loadTasksItems: () => Promise<void>,
): void {
  useEffect(() => {
    if (isTasksView) {
      void loadTasksItems();
    }
  }, [isTasksView, loadTasksItems]);
}
