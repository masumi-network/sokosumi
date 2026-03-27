import { TaskLinkType } from "@sokosumi/database";

import { badRequest } from "@/helpers/error";
import {
  type TaskLinkRelationResponse,
  type TaskLinkResponse,
  taskLinkSchema,
} from "@/schemas/task-link.schema";
import type { TaskLinkPeerTaskRow, TaskLinkRow } from "@/types/task-link";

interface TaskLinkWriteData {
  fromTaskId: string;
  toTaskId: string;
  type: TaskLinkType;
}

function mapTaskLinkRelation(
  type: TaskLinkType,
  outgoing: boolean,
): TaskLinkRelationResponse {
  switch (type) {
    case TaskLinkType.RELATES:
      return "related";
    case TaskLinkType.BLOCKS:
      return outgoing ? "blocks" : "blocked_by";
    case TaskLinkType.PARENT:
      return outgoing ? "parent" : "child";
    case TaskLinkType.DUPLICATE:
      return "duplicate";
  }
}

export function assertTaskLinkAllowed(
  fromTaskId: string,
  toTaskId: string,
): void {
  if (fromTaskId === toTaskId) {
    throw badRequest("A task cannot link to itself");
  }
}

export function mapTaskLinkRelationToWriteData(
  taskId: string,
  peerTaskId: string,
  relation: TaskLinkRelationResponse,
): TaskLinkWriteData {
  switch (relation) {
    case "related":
      return {
        fromTaskId: taskId,
        toTaskId: peerTaskId,
        type: TaskLinkType.RELATES,
      };
    case "blocks":
      return {
        fromTaskId: taskId,
        toTaskId: peerTaskId,
        type: TaskLinkType.BLOCKS,
      };
    case "blocked_by":
      return {
        fromTaskId: peerTaskId,
        toTaskId: taskId,
        type: TaskLinkType.BLOCKS,
      };
    case "parent":
      return {
        fromTaskId: taskId,
        toTaskId: peerTaskId,
        type: TaskLinkType.PARENT,
      };
    case "child":
      return {
        fromTaskId: peerTaskId,
        toTaskId: taskId,
        type: TaskLinkType.PARENT,
      };
    case "duplicate":
      return {
        fromTaskId: taskId,
        toTaskId: peerTaskId,
        type: TaskLinkType.DUPLICATE,
      };
  }
}

export function mapTaskLink(
  taskId: string,
  link: TaskLinkRow,
  peerTask: TaskLinkPeerTaskRow,
): TaskLinkResponse {
  const outgoing = link.fromTaskId === taskId;

  return taskLinkSchema.parse({
    id: link.id,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    relation: mapTaskLinkRelation(link.type, outgoing),
    note: link.note,
    peerTask,
  });
}

function getLoadedPeerTaskForTask(
  taskId: string,
  link: TaskLinkRow,
): TaskLinkPeerTaskRow {
  const peerTask = link.fromTaskId === taskId ? link.toTask : link.fromTask;

  if (!peerTask) {
    throw new Error(`Task link ${link.id} is missing peerTask`);
  }

  return peerTask;
}

export function mapTaskLinkForTask(taskId: string, link: TaskLinkRow) {
  return mapTaskLink(taskId, link, getLoadedPeerTaskForTask(taskId, link));
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
