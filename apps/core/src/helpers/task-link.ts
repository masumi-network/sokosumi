import { badRequest } from "@/helpers/error";
import {
  type TaskLinkResponse,
  taskLinkSchema,
} from "@/schemas/task-link.schema";
import type { TaskLinkRow } from "@/types/task-link";

export function assertTaskLinkAllowed(
  fromTaskId: string,
  toTaskId: string,
): void {
  if (fromTaskId === toTaskId) {
    throw badRequest("A task cannot link to itself");
  }
}

export function mapTaskLinkForTask(
  taskId: string,
  link: TaskLinkRow,
): TaskLinkResponse {
  const outgoing = link.fromTaskId === taskId;
  return taskLinkSchema.parse({
    id: link.id,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    type: link.type,
    note: link.note,
    fromTaskId: link.fromTaskId,
    toTaskId: link.toTaskId,
    direction: outgoing ? "outgoing" : "incoming",
    peerTaskId: outgoing ? link.toTaskId : link.fromTaskId,
  });
}

export function mapTaskLinksForTask(
  linksFrom: TaskLinkRow[],
  linksTo: TaskLinkRow[],
): TaskLinkResponse[] {
  return [
    ...linksFrom.map((link) => mapTaskLinkForTask(link.fromTaskId, link)),
    ...linksTo.map((link) => mapTaskLinkForTask(link.toTaskId, link)),
  ];
}
