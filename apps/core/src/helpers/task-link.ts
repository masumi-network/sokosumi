import { badRequest } from "@/helpers/error";
import {
  type TaskLinkPeerTaskResponse,
  taskLinkPeerTaskSchema,
  type TaskLinkResponse,
  taskLinkSchema,
} from "@/schemas/task-link.schema";
import type { TaskLinkPeerTaskRow, TaskLinkRow } from "@/types/task-link";

interface MapTaskLinkOptions {
  peerTask?: TaskLinkPeerTaskRow | null;
}

function mapTaskLinkPeerTask(
  peerTask: TaskLinkPeerTaskRow | null | undefined,
): TaskLinkPeerTaskResponse | null {
  if (!peerTask) {
    return null;
  }

  return taskLinkPeerTaskSchema.parse(peerTask);
}

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
  options?: MapTaskLinkOptions,
): TaskLinkResponse {
  const outgoing = link.fromTaskId === taskId;
  const peerTask =
    options && "peerTask" in options
      ? options.peerTask
      : (outgoing ? link.toTask : link.fromTask) ?? null;

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
    peerTask: mapTaskLinkPeerTask(peerTask),
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
