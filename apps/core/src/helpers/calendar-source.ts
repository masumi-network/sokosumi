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

  return `workspace:${source.sourceWorkspaceId}`;
}
