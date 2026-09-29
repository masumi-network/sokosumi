export type SchedulesViewMode = "list" | "grid";

export const SCHEDULES_VIEW_MODE_COOKIE_NAME = "schedules_view_mode";

/** Match Files: a year-long cookie, with list as the default. */
export function parseSchedulesViewMode(
  value: string | undefined,
): SchedulesViewMode {
  return value === "grid" ? "grid" : "list";
}

export function serializeSchedulesViewModeCookie(
  mode: SchedulesViewMode,
): string {
  return `${SCHEDULES_VIEW_MODE_COOKIE_NAME}=${mode}; path=/; max-age=${60 * 60 * 24 * 365}`;
}
