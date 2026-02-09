export type TasksViewMode = "board" | "list";

export const TASKS_VIEW_MODE_COOKIE_NAME = "tasks_view_mode";
export const TASKS_VIEW_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTasksViewMode(
  value: string | null | undefined,
): TasksViewMode | null {
  if (value === "board" || value === "list") {
    return value;
  }

  return null;
}

export function serializeTasksViewModeCookie(mode: TasksViewMode): string {
  return `${TASKS_VIEW_MODE_COOKIE_NAME}=${mode}; path=/; max-age=${TASKS_VIEW_MODE_COOKIE_MAX_AGE}`;
}
