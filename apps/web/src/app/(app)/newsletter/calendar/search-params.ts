import { createLoader, parseAsString } from "nuqs/server";

export const calendarSearchParams = {
  month: parseAsString,
  timezone: parseAsString,
};
export const loadCalendarSearchParams = createLoader(calendarSearchParams);
