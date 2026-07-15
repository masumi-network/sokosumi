import type { createTaskLink } from "@/lib/actions/task/action";
import {
  type TaskLink,
  TaskLinkRelation,
  type TaskLinkRelation as TaskLinkRelationValue,
  type TaskListItem,
} from "@/lib/clients/generated/core/types.gen";
import type { TaskStatus } from "@/lib/types/core-dto";

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
  relation: TaskLinkRelationValue;
}

export const TASK_STATUS = {
  DRAFT: "DRAFT",
  QUEUED: "QUEUED",
  READY: "READY",
  GRANT_PENDING: "GRANT_PENDING",
  INPUT_REQUIRED: "INPUT_REQUIRED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  OUT_OF_CREDITS: "OUT_OF_CREDITS",
  CREDITS_TOPPED_UP: "CREDITS_TOPPED_UP",
  RUNNING: "RUNNING",
  AWAITING_EXTERNAL: "AWAITING_EXTERNAL",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  CANCELED: "CANCELED",
} as const satisfies Record<TaskStatus, TaskStatus>;

type TaskLinkActionInput = Pick<
  Parameters<typeof createTaskLink>[0],
  "type" | "direction"
>;

export function getTaskLinkActionInput(
  relation: TaskLinkRelationValue,
): TaskLinkActionInput {
  switch (relation) {
    case TaskLinkRelation.RELATED:
      return {
        type: "RELATES" as TaskLinkActionInput["type"],
        direction: "outgoing",
      };
    case TaskLinkRelation.BLOCKS:
      return {
        type: "BLOCKS" as TaskLinkActionInput["type"],
        direction: "outgoing",
      };
    case TaskLinkRelation.BLOCKED_BY:
      return {
        type: "BLOCKS" as TaskLinkActionInput["type"],
        direction: "incoming",
      };
    case TaskLinkRelation.PARENT:
      return {
        type: "PARENT" as TaskLinkActionInput["type"],
        direction: "outgoing",
      };
    case TaskLinkRelation.CHILD:
      return {
        type: "PARENT" as TaskLinkActionInput["type"],
        direction: "incoming",
      };
    case TaskLinkRelation.DUPLICATE:
      return {
        type: "DUPLICATE" as TaskLinkActionInput["type"],
        direction: "outgoing",
      };
  }
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
