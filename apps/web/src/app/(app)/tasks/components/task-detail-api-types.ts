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

export function mapVisibleTaskLinks(links: TaskLink[]): VisibleTaskLink[] {
  return (
    links
      .filter((link) => link.peerTask.archivedAt === null)
      // A series' released runs are managed by the schedule series and surface
      // under Upcoming/History on the template, so they are not user-managed
      // "linked tasks". The reverse run -> series link (`schedule_series`) stays
      // so a released run can still navigate back to its template.
      .filter((link) => link.relation !== TaskLinkRelation.SCHEDULE_RUN)
      .map((link) => ({
        id: link.peerTask.id,
        name: link.peerTask.name,
        status: link.peerTask.status,
        relation: link.relation,
      }))
  );
}
