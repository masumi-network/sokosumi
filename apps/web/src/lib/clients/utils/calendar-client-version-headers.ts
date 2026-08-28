import {
  CALENDAR_CLIENT_VERSION,
  CALENDAR_CLIENT_VERSION_HEADER,
} from "@sokosumi/utils";

export function buildCalendarClientVersionHeaders(): Record<string, string> {
  return {
    [CALENDAR_CLIENT_VERSION_HEADER]: String(CALENDAR_CLIENT_VERSION),
  };
}
