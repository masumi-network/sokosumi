import type { TasksViewMode } from "@/lib/ui-preferences/tasks-view-mode";

type TasksTabValue = "tasks" | "jobs";

interface ShouldShowTasksEmptyStateOverlayParams {
  activeTab: TasksTabValue;
  taskCount: number;
  viewMode: TasksViewMode;
  guideCompleted: boolean;
}

export function shouldShowTasksEmptyStateOverlay({
  activeTab,
  taskCount,
  viewMode,
  guideCompleted,
}: ShouldShowTasksEmptyStateOverlayParams) {
  return (
    activeTab === "tasks" &&
    taskCount === 0 &&
    viewMode === "board" &&
    !guideCompleted
  );
}
