import {
  type CreateTaskContext,
  type Task,
  TaskStatus,
  type TaskTagId,
} from "@sokosumi/core-client";
import { buildAdHocDesignMdPrefix } from "@sokosumi/utils";
import { taskService } from "@/lib/services/task.service";
import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";

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

export function normalizeOptionalProjectId(
  projectId?: string | null,
): string | null | undefined {
  if (typeof projectId === "undefined") {
    return undefined;
  }

  const trimmedProjectId = projectId?.trim();
  return trimmedProjectId ? trimmedProjectId : null;
}

/**
 * Ad hoc overrides are the only client-supplied DESIGN.md attach path. Keep
 * them limited to https blobs under the caller's own ad hoc prefix before
 * forwarding the URL to Core, which performs its own DESIGN.md URL check.
 */
function resolveDesignMdAttachmentUrl(url: string, userId: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Invalid DESIGN.md attachment URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("DESIGN.md attachment URL must use https");
  }

  const expectedPathPrefix = `/${buildAdHocDesignMdPrefix(userId)}`;
  if (!parsed.pathname.startsWith(expectedPathPrefix)) {
    throw new Error("DESIGN.md attachment URL is not valid for this user");
  }

  return parsed.href;
}

export function toCoreTaskContext(
  selection: TaskContextSelectionInput,
  userId: string,
): CreateTaskContext {
  if (!selection.brand.enabled) {
    return {
      brand: false,
      briefing: selection.briefingEnabled,
      memory: selection.contextMdEnabled,
    };
  }

  if (selection.brand.source === "custom") {
    if (!selection.brand.custom) {
      throw new Error("Custom DESIGN.md attachment required");
    }

    const customUrl = selection.brand.custom.url;
    let brandUrl: string;
    try {
      brandUrl = resolveDesignMdAttachmentUrl(customUrl, userId);
    } catch (error) {
      // Edit may still carry a stored DESIGN.md that is not under this user's
      // ad-hoc prefix (stale project/workspace brand). Forward non-adhoc https
      // URLs so Core can grandfather the existing attachment. Foreign ad-hoc
      // prefixes still fail here.
      let pathname = "";
      try {
        const parsed = new URL(customUrl);
        if (parsed.protocol !== "https:") {
          throw new Error("DESIGN.md attachment URL must use https");
        }
        pathname = decodeURIComponent(parsed.pathname);
      } catch (parseError) {
        if (
          parseError instanceof Error &&
          parseError.message === "DESIGN.md attachment URL must use https"
        ) {
          throw parseError;
        }
        throw error;
      }
      if (pathname.startsWith("/design-md/adhoc/")) {
        throw error;
      }
      if (!pathname.startsWith("/design-md/")) {
        throw error;
      }
      brandUrl = customUrl;
    }

    return {
      brand: {
        url: brandUrl,
      },
      briefing: selection.briefingEnabled,
      memory: selection.contextMdEnabled,
    };
  }

  return {
    brand: true,
    brandSource: selection.brand.source === "project" ? "project" : "workspace",
    briefing: selection.briefingEnabled,
    memory: selection.contextMdEnabled,
  };
}

export function resolveAssigneeWrite(
  assigneeId?: string | null,
  assigneeSokoBotId?: string | null,
  assigneeUserId?: string | null,
): {
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
} {
  const sokoBotId = assigneeSokoBotId?.trim() || null;
  if (sokoBotId) {
    return {
      assigneeId: null,
      assigneeSokoBotId: sokoBotId,
      assigneeUserId: null,
    };
  }

  const userId =
    typeof assigneeUserId === "string" ? assigneeUserId.trim() || null : null;
  if (userId) {
    return {
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: userId,
    };
  }

  return {
    assigneeId: assigneeId?.trim() ? assigneeId : null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
  };
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
    ...(trimmedName ? { name: trimmedName } : {}),
  });
}
