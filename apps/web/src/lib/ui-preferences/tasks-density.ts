export type TasksDensity = "normal" | "compact";

export const TASKS_DENSITY_COOKIE_NAME = "tasks_density";
export const TASKS_DENSITY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTasksDensity(
  value: string | null | undefined,
): TasksDensity | null {
  if (value === "normal" || value === "compact") {
    return value;
  }

  return null;
}

export function serializeTasksDensityCookie(density: TasksDensity): string {
  return `${TASKS_DENSITY_COOKIE_NAME}=${density}; path=/; max-age=${TASKS_DENSITY_COOKIE_MAX_AGE}`;
}
