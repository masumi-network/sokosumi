import { type Task, TaskStatus, type TaskTagId } from "@sokosumi/core-client";
import { taskService } from "@/lib/services/task.service";
import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";
import {
  normalizeOptionalProjectId,
  resolveAssigneeWrite,
  toCoreTaskContext,
} from "./task-mutation";

export interface TaskTagWrite {
  workspaceTagIds?: string[];
  dismissedWorkspaceTagIds?: string[];
  dismissedTopicIds?: TaskTagId[];
}

export type TaskTagSnapshot = Required<
  Pick<Task, "tags" | "workspaceTags" | "workspaceTagSuggestions">
>;

export function taskTagSnapshot(task: Task): TaskTagSnapshot {
  return {
    tags: task.tags ?? { manual: [], automatic: [], rejected: [] },
    workspaceTags: task.workspaceTags ?? [],
    workspaceTagSuggestions: task.workspaceTagSuggestions ?? [],
  };
}

export interface TaskContextSelectionInput {
  brand: {
    enabled: boolean;
    source: "project" | "default" | "custom";
    custom?: { url: string } | null;
  };
  briefingEnabled: boolean;
  contextMdEnabled: boolean;
}

/** Queued needs a Run at (ADR 0041), so a Queued create without one is Ready. */
function resolveCreateStatus(
  requestedStatus: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">,
): Extract<TaskStatus, "DRAFT" | "READY"> {
  return requestedStatus === TaskStatus.QUEUED
    ? TaskStatus.READY
    : requestedStatus;
}

export async function createTaskFromDescription(
  input: TaskTagWrite & {
    tagSuggestionReceipt?: string;
    copyOfTaskId?: string;
    name?: string;
    description: string;
    assigneeId: string | null;
    assigneeSokoBotId?: string | null;
    assigneeUserId?: string | null;
    projectId?: string | null;
    userId: string;
    context?: TaskContextSelectionInput;
    status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
    runAt?: string;
    visibility?: "PUBLIC" | "PRIVATE";
    contactIds?: string[];
  },
): Promise<Task> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) {
    throw new Error("Description required");
  }

  const normalizedProjectId = normalizeOptionalProjectId(input.projectId);
  const context = input.context
    ? toCoreTaskContext(input.context, input.userId)
    : undefined;

  const assigneeWrite = resolveAssigneeWrite(
    input.assigneeId,
    input.assigneeSokoBotId,
    input.assigneeUserId,
  );
  const trimmedName = input.name
    ? normalizeTaskNameForCoreApi(input.name)
    : undefined;

  return taskService.createTask({
    ...(input.tagSuggestionReceipt
      ? { tagSuggestionReceipt: input.tagSuggestionReceipt }
      : {}),
    ...(input.workspaceTagIds !== undefined
      ? { workspaceTagIds: input.workspaceTagIds }
      : {}),
    ...(input.dismissedTopicIds !== undefined
      ? { dismissedTopicIds: input.dismissedTopicIds }
      : {}),
    ...(input.dismissedWorkspaceTagIds !== undefined
      ? { dismissedWorkspaceTagIds: input.dismissedWorkspaceTagIds }
      : {}),
    ...(input.copyOfTaskId ? { copyOfTaskId: input.copyOfTaskId } : {}),
    description: trimmedDescription,
    ...assigneeWrite,
    projectId: normalizedProjectId ?? null,
    ...(context ? { context } : {}),
    // Core creates a Task with a Run at in Queued and ignores its status.
    ...(input.runAt
      ? { runAt: new Date(input.runAt) }
      : { status: resolveCreateStatus(input.status) }),
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(input.contactIds?.length ? { contactIds: input.contactIds } : {}),
    ...(trimmedName ? { name: trimmedName } : {}),
  });
}
