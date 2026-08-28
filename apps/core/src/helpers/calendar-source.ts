import { CalendarSourceType } from "@sokosumi/database";

export function getCalendarSourceId(source: {
  sourceWorkspaceId: string;
  sourceType: CalendarSourceType;
  sourceProjectId: string | null;
}): string {
  if (
    source.sourceType === CalendarSourceType.PROJECT &&
    source.sourceProjectId
  ) {
    return `project:${source.sourceProjectId}`;
  }

  if (source.sourceType === CalendarSourceType.LEGACY_UNKNOWN) {
    return `legacy-unknown:${source.sourceWorkspaceId}`;
  }

  return `workspace:${source.sourceWorkspaceId}`;
}
