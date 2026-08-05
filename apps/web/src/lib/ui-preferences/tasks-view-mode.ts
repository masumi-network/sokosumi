export type TasksViewMode = "board" | "list";

export const TASKS_VIEW_MODE_COOKIE_NAME = "tasks_view_mode";
export const TASKS_VIEW_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Kanban is the desktop default; list is easier on narrow screens. */
export const DEFAULT_TASKS_VIEW_MODE_DESKTOP: TasksViewMode = "board";
export const DEFAULT_TASKS_VIEW_MODE_MOBILE: TasksViewMode = "list";

export function parseTasksViewMode(
  value: string | null | undefined,
): TasksViewMode | null {
  if (value === "board" || value === "list") {
    return value;
  }

  return null;
}

/**
 * Cookie preference wins. Without one, mobile/tablet UA defaults to list;
 * desktop defaults to board.
 */
export function resolveDefaultTasksViewMode(options: {
  persisted: TasksViewMode | null;
  preferList: boolean;
}): TasksViewMode {
  if (options.persisted) {
    return options.persisted;
  }

  return options.preferList
    ? DEFAULT_TASKS_VIEW_MODE_MOBILE
    : DEFAULT_TASKS_VIEW_MODE_DESKTOP;
}

/** True when the request UA looks like a phone or tablet. */
export function preferTasksListFromDeviceType(
  deviceType: string | undefined,
): boolean {
  return deviceType === "mobile" || deviceType === "tablet";
}

export function serializeTasksViewModeCookie(mode: TasksViewMode): string {
  return `${TASKS_VIEW_MODE_COOKIE_NAME}=${mode}; path=/; max-age=${TASKS_VIEW_MODE_COOKIE_MAX_AGE}`;
}
