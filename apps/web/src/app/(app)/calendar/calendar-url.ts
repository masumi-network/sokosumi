import type { CalendarPageSearchParams } from "./load-calendar-page";

// Everything the Calendar reads from its URL; a param left out would be
// dropped from redirects.
const CALENDAR_PARAMS = [
  "types",
  "assigneeId",
  "assigneeUserId",
  "date",
  "projectId",
  "scope",
  "status",
  "postStatus",
  "provider",
  "view",
  "timezone",
  // Legacy: became `types=social`.
  "socialOnly",
] as const satisfies ReadonlyArray<
  keyof CalendarPageSearchParams | "socialOnly"
>;

type CalendarParams = Partial<
  Record<(typeof CALENDAR_PARAMS)[number], string | string[] | undefined>
>;

/**
 * `/calendar` with the Calendar's params from another page's URL. The old
 * "Social posts only" switch (`socialOnly=true`) becomes `types=social`.
 */
export function calendarUrl(params: CalendarParams): string {
  const query = new URLSearchParams();
  for (const key of CALENDAR_PARAMS) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) query.set(key, value);
  }
  if (query.get("socialOnly") === "true") query.set("types", "social");
  query.delete("socialOnly");
  const queryString = query.toString();
  return queryString ? `/calendar?${queryString}` : "/calendar";
}
