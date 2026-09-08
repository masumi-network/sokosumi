export const TASKS_TAB_VALUES = ["tasks", "jobs"] as const;
export type TasksTabValue = (typeof TASKS_TAB_VALUES)[number];
export const TASKS_TAB_PARAM = "tab";
export const DEFAULT_TASKS_TAB: TasksTabValue = "tasks";

export function parseTasksTab(
  raw: string | string[] | undefined,
): TasksTabValue {
  const value =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return value === "jobs" ? "jobs" : DEFAULT_TASKS_TAB;
}

export function applyTasksTabSearchParam(
  current: URLSearchParams,
  tab: TasksTabValue,
): URLSearchParams {
  const next = new URLSearchParams(current.toString());
  next.set(TASKS_TAB_PARAM, tab);
  return next;
}
