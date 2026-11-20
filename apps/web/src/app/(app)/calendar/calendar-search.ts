import type { WorkspaceCalendarEntry } from "@sokosumi/core-client";
import type { LoadedWorkspaceCalendarPage } from "./load-calendar-page";

export function calendarSearchFields(
  entry: WorkspaceCalendarEntry,
  page: Pick<LoadedWorkspaceCalendarPage, "sources" | "coworkerOptions">,
) {
  switch (entry.kind) {
    case "RUN":
    case "RUN_AT":
      return {
        primary: [entry.taskName],
        secondary: [
          entry.taskStatus,
          page.sources.find((source) => source.sourceId === entry.sourceId)
            ?.displayName,
          page.coworkerOptions.find(
            (person) =>
              person.id === (entry.taskAssigneeId ?? entry.taskAssigneeUserId),
          )?.name,
        ],
      };
    case "socialPost":
      return {
        primary: [entry.text],
        secondary: [
          entry.provider,
          entry.externalHandle,
          entry.projectName,
          entry.scheduledByName,
        ],
      };
    case "newsletterIssue":
      return {
        primary: [entry.subject],
        secondary: [entry.projectName, entry.status],
      };
    case "contactFollowUp":
      return {
        primary: [entry.name],
        secondary: [entry.organization, entry.nextStep],
      };
    case "marketingPiece":
      return {
        primary: [entry.title],
        secondary: [entry.projectName, entry.channel, entry.format],
      };
    case "sokoBotRun":
      return {
        primary: [entry.name],
        secondary: [entry.botName, entry.projectName],
      };
  }
}
