import {
  type TaskLink,
  type TaskLinkRelation,
  type TaskListItem,
  TaskStatus,
} from "@sokosumi/core-client";
import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";

export type { TaskStatus };

export interface TaskPickerTask {
  id: string;
  name: string;
  status: TaskStatus;
}

export interface VisibleTaskLink {
  id: string;
  name: string;
  identifier: string | null;
  status: TaskStatus;
  relation: TaskLinkRelation;
}

export function mapTaskListItemToTaskPickerTask(
  task: TaskListItem,
): TaskPickerTask {
  return {
    id: task.id,
    name: stripInlineMarkdown(task.name),
    status: task.status,
  };
}

export function mapVisibleTaskLinks(links: TaskLink[]): VisibleTaskLink[] {
  return links
    .filter((link) => link.peerTask.archivedAt === null)
    .map((link) => ({
      id: link.peerTask.id,
      name: stripInlineMarkdown(link.peerTask.name),
      identifier: link.peerTask.identifier,
      status: link.peerTask.status,
      relation: link.relation,
    }));
}
