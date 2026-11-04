import type { WorkspaceCalendarEntry } from "@sokosumi/core-client";

/** The features the Calendar shows. Each one is a filter on it. */
export const CALENDAR_TYPES = [
  "tasks",
  "social",
  "newsletter",
  "contacts",
  "marketing",
] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

const TYPE_OF_KIND = {
  RUN: "tasks",
  RUN_AT: "tasks",
  socialPost: "social",
  newsletterIssue: "newsletter",
  contactFollowUp: "contacts",
  marketingPiece: "marketing",
} as const satisfies Record<WorkspaceCalendarEntry["kind"], CalendarType>;

export function calendarTypeOf(item: WorkspaceCalendarEntry): CalendarType {
  return TYPE_OF_KIND[item.kind];
}

/** The known types of a comma-separated `types` value, in feature order. */
export function parseCalendarTypes(value: string | undefined): CalendarType[] {
  const requested = value?.split(",") ?? [];
  return CALENDAR_TYPES.filter((type) => requested.includes(type));
}

/**
 * The features a workspace offers right now. Matches Core's silent drops:
 * Newsletter only where it has it, Follow-ups never under a Project, and the
 * Marketing plan never under `scope=owned`.
 */
export function availableCalendarTypes(
  newsletterEnabled: boolean,
  options: {
    projectId?: string | null;
    scope?: "owned" | "workspace";
  } = {},
): CalendarType[] {
  return CALENDAR_TYPES.filter((type) => {
    if (type === "newsletter" && !newsletterEnabled) return false;
    if (type === "contacts" && options.projectId) return false;
    if (type === "marketing" && options.scope === "owned") return false;
    return true;
  });
}

/** The chosen features among those offered; none chosen means every one. */
export function selectedCalendarTypes(
  requested: readonly CalendarType[] | null | undefined,
  available: readonly CalendarType[],
): CalendarType[] {
  const chosen = available.filter((type) => requested?.includes(type));
  return chosen.length > 0 ? chosen : [...available];
}

/** The `types` value Core takes for the selected features. */
export function calendarTypesQuery(selected: readonly CalendarType[]): string {
  return selected.join(",");
}

/** Social posts and nothing else: the view Social plans a feed in. */
export function isSocialOnly(types: readonly CalendarType[]): boolean {
  return types.length === 1 && types[0] === "social";
}
