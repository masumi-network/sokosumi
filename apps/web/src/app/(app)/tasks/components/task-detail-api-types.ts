import {
  type TaskLink,
  type TaskLinkRelation,
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
  return links
    .filter((link) => link.peerTask.archivedAt === null)
    .map((link) => ({
      id: link.peerTask.id,
      name: link.peerTask.name,
      status: link.peerTask.status,
      relation: link.relation,
    }));
}
