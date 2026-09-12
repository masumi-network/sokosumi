import {
  type TaskLink,
  TaskLinkRelation,
  type TaskListItem,
  TaskStatus,
} from "@/lib/clients/generated/core";

export type { TaskStatus };

export interface TaskPickerTask {
  id: string;
  name: string;
  status: TaskStatus;
}

export interface VisibleTaskLink {
  id: string;
  name: string;
  status: TaskStatus;
  relation: TaskLinkRelation;
}

export function mapTaskListItemToTaskPickerTask(
  task: TaskListItem,
): TaskPickerTask {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
  };
}

export interface MapVisibleTaskLinksOptions {
  /** Drop the scheduler's template -> run links (owned by the Schedule section). */
  hideScheduleRuns?: boolean;
}

export function mapVisibleTaskLinks(
  links: TaskLink[],
  { hideScheduleRuns = false }: MapVisibleTaskLinksOptions = {},
): VisibleTaskLink[] {
  return (
    links
      .filter((link) => link.peerTask.archivedAt === null)
      // A beta Calendar viewer sees a series' released runs under
      // Upcoming/History on the template, so they are not duplicated as
      // "linked tasks". A non-beta viewer has no Schedule section, so those runs
      // stay visible here. The reverse run -> series link (`schedule_series`)
      // always stays, so a released run can navigate back to its template.
      .filter(
        (link) =>
          !hideScheduleRuns || link.relation !== TaskLinkRelation.SCHEDULE_RUN,
      )
      .map((link) => ({
        id: link.peerTask.id,
        name: link.peerTask.name,
        status: link.peerTask.status,
        relation: link.relation,
      }))
  );
}
