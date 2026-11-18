import type { z } from "@hono/zod-openapi";
import { TaskLinkType } from "@sokosumi/database";
import { formatTaskIdentifier } from "@sokosumi/utils";

import {
  badRequest,
  formatZodErrorMessage,
  unprocessableEntity,
} from "@/helpers/error";
import {
  type TaskLinkRelationResponse,
  type TaskLinkResponse,
  taskLinkSchema,
  type UserWritableTaskLinkRelationResponse,
} from "@/schemas/task-link.schema";
import type { TaskLinkPeerTaskRow, TaskLinkRow } from "@/types/task-link";

interface TaskLinkWriteData {
  fromTaskId: string;
  toTaskId: string;
  type: TaskLinkType;
}

function isSymmetricTaskLinkRelation(
  relation: TaskLinkRelationResponse,
): boolean {
  return relation === "related" || relation === "duplicate";
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

function mapTaskLinkPeerTask(peerTask: TaskLinkRow["toTask"]) {
  if (!peerTask) {
    return null;
  }

  return {
    id: peerTask.id,
    name: peerTask.name,
    status: peerTask.status,
    archivedAt: peerTask.archivedAt ?? null,
    identifier: formatTaskIdentifier(
      peerTask.project?.identifier,
      peerTask.number,
    ),
  };
}

export function assertTaskLinkAllowed(
  fromTaskId: string,
  toTaskId: string,
): void {
  if (fromTaskId === toTaskId) {
    throw badRequest("A task cannot link to itself");
  }
}

const RETIRED_PARENT_LINK_RELATIONS: readonly unknown[] = ["parent", "child"];

export const PARENT_LINK_RETIRED_MESSAGE =
  "Parent links are now sub-tasks. Use POST /v1/tasks/{id}/move with parentTaskId.";

/**
 * Validation hook for the link write routes. A `parent` or `child` relation
 * fails the request schema; it gets a 400 that names the replacement instead
 * of the generic 422 of `defaultValidationHook`, which handles the rest.
 */
export function taskLinkWriteValidationHook(result: {
  success: boolean;
  target: string;
  data?: unknown;
  error?: z.ZodError;
}): undefined {
  if (result.success || !result.error) return undefined;
  const relation =
    result.target === "json" &&
    typeof result.data === "object" &&
    result.data !== null &&
    "relation" in result.data
      ? result.data.relation
      : undefined;
  if (RETIRED_PARENT_LINK_RELATIONS.includes(relation)) {
    throw badRequest(PARENT_LINK_RETIRED_MESSAGE);
  }
  throw unprocessableEntity(formatZodErrorMessage(result.error));
}

/**
 * Takes every relation, `parent` and `child` included. Callers refuse those
 * two first: user routes by schema, Soko Bot's `link_tasks` in its handler.
 */
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
    default: {
      const _exhaustive: never = relation;
      return _exhaustive;
    }
  }
}

export function mapTaskLinkRelationToTypeForExistingDirection(
  taskId: string,
  link: TaskLinkRow,
  relation: UserWritableTaskLinkRelationResponse,
): TaskLinkType {
  const peerTaskId =
    link.fromTaskId === taskId ? link.toTaskId : link.fromTaskId;
  const nextLink = mapTaskLinkRelationToWriteData(taskId, peerTaskId, relation);

  if (isSymmetricTaskLinkRelation(relation)) {
    return nextLink.type;
  }

  if (
    nextLink.fromTaskId !== link.fromTaskId ||
    nextLink.toTaskId !== link.toTaskId
  ) {
    throw badRequest(
      `Relation ${relation} would require reversing the existing link`,
    );
  }

  return nextLink.type;
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
    peerTask: mapTaskLinkPeerTask(peerTask),
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
