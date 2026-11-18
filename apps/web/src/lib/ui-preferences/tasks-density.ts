import { readCookieValue } from "@/lib/ui-preferences/cookie-header";

export type TasksDensity = "normal" | "compact";

export const TASKS_DENSITY_COOKIE_NAME = "tasks_density";
const TASKS_DENSITY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTasksDensity(
  value: string | null | undefined,
): TasksDensity | null {
  if (value === "normal" || value === "compact") {
    return value;
  }

  return null;
}

/** Read `tasks_density` from a raw Cookie header / `document.cookie` string. */
export function parseTasksDensityCookieHeader(
  documentCookie: string,
): TasksDensity | null {
  return parseTasksDensity(
    readCookieValue(documentCookie, TASKS_DENSITY_COOKIE_NAME),
  );
}

export function serializeTasksDensityCookie(density: TasksDensity): string {
  return `${TASKS_DENSITY_COOKIE_NAME}=${density}; path=/; max-age=${TASKS_DENSITY_COOKIE_MAX_AGE}`;
}
