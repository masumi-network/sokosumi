import "server-only";

import type {
  CreateTaskContext,
  GetWorkspacesCalendarData,
  GetWorkspacesCalendarSourcesData,
  MoveTaskRequest,
  Task,
  TaskActivitySummary,
  TaskEvent,
  TaskEventsPaginationMetadata,
  TaskFollower,
  TaskLink,
  TaskLinkDeleted,
  TaskParticipant,
  TaskPriority,
  TaskTagId,
  TaskWorkspace,
  UserWritableTaskLinkRelation,
  WorkspaceCalendarEntry,
  WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import { TaskStatus } from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

interface ListTasksParams {
  status?: TaskStatus | TaskStatus[];
  assigneeId?: string;
  assigneeSokoBotId?: string;
  assigneeUserId?: string;
  projectId?: string;
  workspaceTagId?: string;
  topicTagId?: TaskTagId;
  q?: string;
  search?: string;
  scope?: "workspace" | "owned" | "mine" | "handedOff";
  visibility?: "PUBLIC" | "PRIVATE";
  cursor?: string | null;
  limit?: number;
  sort?: "createdAt" | "updatedAt" | "priority" | "dueOn" | "oldest";
  /** Only the Tasks this Task Schedule created. */
  scheduleId?: string;
  /** Only Tasks due on or before this day, `YYYY-MM-DD`. */
  dueOnTo?: string;
  /** Only Tasks whose status has not changed since this time. */
  statusBefore?: Date;
  /** Archived Tasks instead, most recently archived first. */
  archived?: boolean;
  /** Only this Task's direct sub-tasks, in their order. */
  parentTaskId?: string;
  /** Only Tasks with a mention of the caller that the caller has not answered. */
  unansweredMention?: boolean;
}

interface CreateTaskInput {
  workspaceTagIds?: string[];
  dismissedWorkspaceTagIds?: string[];
  dismissedTopicIds?: TaskTagId[];
  tagSuggestionReceipt?: string;
  name?: string;
  description: string | null;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  context?: CreateTaskContext;
  status?: Extract<TaskStatus, "DRAFT" | "READY">;
  /** Start at this future time: Core creates the Task Queued. */
  runAt?: Date;
  visibility?: "PUBLIC" | "PRIVATE";
  /** Makes the Task a sub-task of this one, last or after `afterTaskId`. */
  parentTaskId?: string;
  afterTaskId?: string;
  /** `YYYY-MM-DD`. */
  dueOn?: string | null;
}

interface PatchTaskInput {
  expectedWorkspaceTagIds?: string[];
  workspaceTagIds?: string[];
  dismissedWorkspaceTagIds?: string[];
  dismissedTopicIds?: TaskTagId[];
  name?: string;
  description?: string | null;
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  context?: CreateTaskContext;
  /** A future time queues the Task; null clears a saved Run at. */
  runAt?: Date | null;
  priority?: TaskPriority;
  /** `YYYY-MM-DD`; null clears the due date. */
  dueOn?: string | null;
}

interface CreateTaskEventInput {
  status?: TaskStatus;
  comment?: string;
  mentionedUserIds?: string[];
}

interface CreateTaskLinkInput {
  toTaskId: string;
  relation: UserWritableTaskLinkRelation;
  note?: string | null;
}

function assigneeWriteFields(
  assigneeId?: string | null,
  assigneeSokoBotId?: string | null,
  assigneeUserId?: string | null,
): {
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
} {
  if (
    typeof assigneeId === "undefined" &&
    typeof assigneeSokoBotId === "undefined" &&
    typeof assigneeUserId === "undefined"
  ) {
    return {};
  }

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

export interface WorkspaceCalendarPage {
  items: WorkspaceCalendarEntry[];
  pagination: {
    cursor: string | null;
    limit: number;
    total: number;
    nextCursor: string | null;
  } | null;
}

export const taskService = (() => {
  async function listTasks(params: ListTasksParams = {}) {
    const result = await coreClient.getTasks({
      status: Array.isArray(params.status)
        ? params.status
        : params.status
          ? [params.status]
          : undefined,
      ...(params.assigneeSokoBotId
        ? { assigneeSokoBotId: params.assigneeSokoBotId }
        : params.assigneeUserId
          ? { assigneeUserId: params.assigneeUserId }
          : { assigneeId: params.assigneeId }),
      projectId: params.projectId,
      parentTaskId: params.parentTaskId,
      workspaceTagId: params.workspaceTagId,
      topicTagId: params.topicTagId,
      scheduleId: params.scheduleId,
      dueOnTo: params.dueOnTo,
      statusBefore: params.statusBefore,
      ...(params.archived ? { archived: "true" as const } : {}),
      ...(params.unansweredMention
        ? { unansweredMention: "true" as const }
        : {}),
      q: params.q,
      search: params.search,
      scope: params.scope,
      ...(params.visibility ? { visibility: params.visibility } : {}),
      cursor: params.cursor ?? undefined,
      limit: params.limit,
      sort: params.sort,
    });

    return {
      tasks: result.data ?? [],
      pagination: result.meta?.pagination ?? null,
    };
  }

  async function getWorkspaceCalendar(
    query: GetWorkspacesCalendarData["query"],
  ): Promise<WorkspaceCalendarPage> {
    const result = await coreClient.getWorkspaceCalendar(query);

    return {
      items: result.data,
      pagination: result.meta?.pagination ?? null,
    };
  }

  async function getWorkspaceCalendarSources(
    query?: GetWorkspacesCalendarSourcesData["query"],
  ): Promise<WorkspaceCalendarSource[]> {
    const result = await coreClient.getWorkspaceCalendarSources(query);
    // Core returns { sources, features }; Web's Show filter (PR 2) will use features.
    return result.data.sources;
  }

  async function getTaskById(taskId: string): Promise<Task | null> {
    try {
      const result = await coreClient.getTaskById(taskId);
      return result.data;
    } catch {
      return null;
    }
  }

  /** An archived Task, read-only; null when there is none to read. */
  async function getArchivedTask(taskId: string): Promise<Task | null> {
    try {
      const result = await coreClient.getTaskById(taskId, { archived: "true" });
      return result.data;
    } catch {
      return null;
    }
  }

  async function listTaskEvents(
    taskId: string,
    params: { cursor?: string | null; limit?: number } = {},
  ): Promise<{
    events: TaskEvent[];
    pagination: TaskEventsPaginationMetadata;
  }> {
    const result = await coreClient.getTaskEvents(taskId, {
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });

    return {
      events: result.data,
      pagination: result.meta.pagination,
    };
  }

  /**
   * Events strictly before `untilEventId` (ascending), for expanding older comments.
   */
  async function listTaskEventsBefore(
    taskId: string,
    untilEventId: string,
  ): Promise<TaskEvent[]> {
    const older: TaskEvent[] = [];
    let cursor: string | undefined;

    for (;;) {
      const page = await listTaskEvents(taskId, {
        cursor,
        limit: 100,
      });
      for (const event of page.events) {
        if (event.id === untilEventId) {
          return older;
        }
        older.push(event);
      }
      const next = page.pagination.nextCursor;
      if (!next || next === cursor) {
        return older;
      }
      cursor = next;
    }
  }

  async function getTaskWorkspace(
    taskId: string,
  ): Promise<TaskWorkspace | null> {
    try {
      const result = await coreClient.getTaskWorkspace(taskId);
      return result.data;
    } catch {
      return null;
    }
  }

  async function suggestTaskTags(input: {
    name?: string;
    description?: string | null;
  }) {
    const result = await coreClient.suggestTaskTags(input);
    return result.data;
  }

  async function createTask(input: CreateTaskInput): Promise<Task> {
    const result = await coreClient.createTask({
      ...input,
      ...assigneeWriteFields(
        input.assigneeId,
        input.assigneeSokoBotId,
        input.assigneeUserId,
      ),
    });

    if (!result.data) {
      throw new Error("Failed to create task");
    }

    return result.data;
  }

  async function moveSubtask(
    taskId: string,
    move: MoveTaskRequest,
  ): Promise<Task> {
    const result = await coreClient.moveSubtask(taskId, move);
    return result.data;
  }

  async function createTaskEvent(
    taskId: string,
    input: CreateTaskEventInput,
  ): Promise<TaskEvent> {
    const result = await coreClient.createTaskEvent(taskId, input);

    if (!result.data) {
      throw new Error("Failed to create task event");
    }

    return result.data;
  }

  async function patchTask(
    taskId: string,
    input: PatchTaskInput,
  ): Promise<Task> {
    const result = await coreClient.patchTask(taskId, {
      ...input,
      ...assigneeWriteFields(
        input.assigneeId,
        input.assigneeSokoBotId,
        input.assigneeUserId,
      ),
    });

    if (!result.data) {
      throw new Error("Failed to update task");
    }

    return result.data;
  }

  /**
   * Re-dates the reader's overdue Tasks (as of their `today`) to `to` in the
   * active workspace. Core picks them and re-checks each under lock; what it
   * moved comes back with the data Undo needs.
   */
  async function moveOverdueTasks(input: { today: string; to: string }) {
    const result = await coreClient.moveOverdueTasks(input);

    if (!result.data) {
      throw new Error("Failed to move overdue tasks");
    }

    return result.data;
  }

  /** Puts moved Tasks back, each only while untouched since the move. */
  async function undoMoveOverdueTasks(input: {
    to: string;
    tasks: { id: string; from: string; version: string }[];
  }) {
    const result = await coreClient.undoMoveOverdueTasks(input);

    if (!result.data) {
      throw new Error("Failed to undo moving overdue tasks");
    }

    return result.data;
  }

  async function moveTaskToWorkspace(
    taskId: string,
    organizationId: string | null,
  ): Promise<Task> {
    const result = await coreClient.moveTaskToWorkspace(taskId, {
      organizationId,
    });

    if (!result.data) {
      throw new Error("Failed to move task to workspace");
    }

    return result.data;
  }

  async function listTaskLinks(taskId: string): Promise<TaskLink[]> {
    const result = await coreClient.getTaskLinks(taskId);
    return result.data;
  }

  async function createTaskLink(
    taskId: string,
    input: CreateTaskLinkInput,
  ): Promise<TaskLink> {
    const result = await coreClient.createTaskLink(taskId, input);

    if (!result.data) {
      throw new Error("Failed to create task link");
    }

    return result.data;
  }

  async function deleteTaskLink(
    taskId: string,
    linkId: string,
  ): Promise<TaskLinkDeleted> {
    const result = await coreClient.deleteTaskLink(taskId, linkId);

    if (!result.data) {
      throw new Error("Failed to delete task link");
    }

    return result.data;
  }

  async function removeTaskParticipant(
    taskId: string,
    userId: string,
  ): Promise<TaskParticipant[]> {
    const result = await coreClient.deleteTaskParticipant(taskId, userId);

    if (!result.data) {
      throw new Error("Failed to remove task participant");
    }

    return result.data.participants;
  }

  async function followTask(taskId: string): Promise<TaskFollower[]> {
    const result = await coreClient.followTask(taskId);

    if (!result.data) {
      throw new Error("Failed to follow task");
    }

    return result.data.followers;
  }

  async function unfollowTask(taskId: string): Promise<TaskFollower[]> {
    const result = await coreClient.unfollowTask(taskId);

    if (!result.data) {
      throw new Error("Failed to stop following task");
    }

    return result.data.followers;
  }

  async function subscribeTaskParticipant(
    taskId: string,
  ): Promise<TaskParticipant[]> {
    const result = await coreClient.subscribeTaskParticipant(taskId);

    if (!result.data) {
      throw new Error("Failed to subscribe to task");
    }

    return result.data.participants;
  }

  async function deleteTask(taskId: string): Promise<Task> {
    const result = await coreClient.deleteTask(taskId);

    if (!result.data) {
      throw new Error("Failed to delete task");
    }

    return result.data;
  }

  /**
   * Counts for the /chat landing. Never throws — the landing is a greeting, so
   * a Core hiccup should cost the sentence, not the page. Returns null rather
   * than a zeroed summary so the UI can hide chips instead of claiming "nothing
   * happened". The window itself is session-derived in Core
   * (`max(Session.updatedAt)`); this helper does not stamp anything.
   */
  async function getActivitySummary(params: {
    scope?: "owned" | "workspace";
  }): Promise<TaskActivitySummary | null> {
    try {
      const result = await coreClient.getTasksSummary({
        scope: params.scope ?? "owned",
      });

      return result.data ?? null;
    } catch (error) {
      console.error("Failed to load task activity summary", error);
      return null;
    }
  }

  /** The saved Tasks page query, or null when the person never chose one. */
  async function getSavedTasksViewQuery(): Promise<string | null> {
    const result = await coreClient.getTasksView();
    return result.data?.query ?? null;
  }

  async function saveTasksViewQuery(query: string): Promise<void> {
    await coreClient.putTasksView(query);
  }

  return {
    getSavedTasksViewQuery,
    saveTasksViewQuery,
    getActivitySummary,
    getWorkspaceCalendar,
    getWorkspaceCalendarSources,
    listTasks,
    getTaskById,
    getArchivedTask,
    getTaskWorkspace,
    listTaskEvents,
    listTaskEventsBefore,
    createTask,
    moveSubtask,
    suggestTaskTags,
    createTaskLink,
    createTaskEvent,
    deleteTaskLink,
    removeTaskParticipant,
    subscribeTaskParticipant,
    followTask,
    unfollowTask,
    moveTaskToWorkspace,
    moveOverdueTasks,
    undoMoveOverdueTasks,
    patchTask,
    listTaskLinks,
    deleteTask,
  };
})();
