"use server";

import {
  buildAdHocDesignMdPrefix,
  CORE_API_ERROR_KINDS,
  hasActiveTaskSchedule,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import {
  type CreateScheduledTaskRequest,
  type CreateTaskContext,
  type Task,
  type TaskLink,
  TaskLinkRelation,
  TaskStatus,
  type UserWritableTaskLinkRelation,
} from "@/lib/clients/generated/core";
import { taskService } from "@/lib/services/task.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import { normalizeOptionalProjectId } from "@/lib/utils/project";
import {
  hasTaskScheduleChanged,
  selectionToApiBody,
} from "@/lib/utils/task-schedule";
import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";
import { isUuidString } from "@/lib/utils/uuid";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CreateTaskParameters extends AuthenticatedRequest {
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  projectId?: string | null;
  context?: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY">;
  schedule?: TaskScheduleSelection;
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

interface UpdateTaskParameters extends AuthenticatedRequest {
  taskId: string;
  name: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  projectId?: string | null;
  currentStatus: TaskStatus;
  desiredStatus: TaskStatus;
  schedule?: TaskScheduleSelection;
  hadSchedule?: boolean;
  originalSchedule?: TaskScheduleSelection;
}

interface CreateScheduledTaskParameters extends AuthenticatedRequest {
  operationId: string;
  source: CreateScheduledTaskRequest["source"];
  description?: string | null;
  assigneeId: string;
  context?: TaskContextSelectionInput;
  schedule: TaskScheduleSelection;
}

interface SaveTaskScheduleParameters extends AuthenticatedRequest {
  taskId: string;
  schedule: TaskScheduleSelection;
}

interface ClearTaskScheduleParameters extends AuthenticatedRequest {
  taskId: string;
}

export interface CalendarClientUpgradeRequiredError {
  kind: typeof CORE_API_ERROR_KINDS.CALENDAR_CLIENT_UPGRADE_REQUIRED;
}

type TaskMutationActionResult<T> = ActionResultDto<
  T,
  CalendarClientUpgradeRequiredError
>;

export type CreateTaskResult = TaskMutationActionResult<{
  taskId: string;
  name: string;
}>;
export type UpdateTaskResult = TaskMutationActionResult<{ taskId: string }>;
export type SetTaskStatusResult = TaskMutationActionResult<{ taskId: string }>;
export type CreateScheduledTaskResult = TaskMutationActionResult<{
  taskId: string;
  name: string;
}>;
export type SaveTaskScheduleResult = TaskMutationActionResult<{
  taskId: string;
}>;
export type ClearTaskScheduleResult = TaskMutationActionResult<{
  taskId: string;
}>;
export type CreateTaskAndLinkResult = TaskMutationActionResult<{
  taskId: string;
  createdTaskId: string;
  linkId: string;
  name: string;
}>;

function taskMutationSuccess<T>(value: T): TaskMutationActionResult<T> {
  return toActionResult(ok(value));
}

function calendarClientUpgradeRequired<T>(): TaskMutationActionResult<T> {
  return toActionResult(
    err({
      kind: CORE_API_ERROR_KINDS.CALENDAR_CLIENT_UPGRADE_REQUIRED,
    }),
  );
}

function isCalendarClientUpgradeRequired(
  error: unknown,
): error is CoreApiRequestError {
  return (
    error instanceof CoreApiRequestError &&
    error.status === 426 &&
    error.kind === CORE_API_ERROR_KINDS.CALENDAR_CLIENT_UPGRADE_REQUIRED
  );
}

interface SetTaskStatusFromDragParameters extends AuthenticatedRequest {
  taskId: string;
  desiredStatus: TaskStatus;
  /** Required by Core when reopening CANCELED/COMPLETED → READY (SOK-631). */
  comment?: string;
}

interface DeleteTaskParameters extends AuthenticatedRequest {
  taskId: string;
}

interface MoveTaskToWorkspaceParameters extends AuthenticatedRequest {
  taskId: string;
  organizationId: string | null;
}

interface CreateTaskCommentParameters extends AuthenticatedRequest {
  taskId: string;
  comment: string;
}

interface CreateTaskLinkParameters extends AuthenticatedRequest {
  taskId: string;
  relatedTaskId: string;
  relation: UserWritableTaskLinkRelation;
  note?: string | null;
  replaceExistingParent?: boolean;
}

interface DeleteTaskLinkParameters extends AuthenticatedRequest {
  taskId: string;
  linkId: string;
}

interface CreateAndLinkTaskParameters extends AuthenticatedRequest {
  taskId: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  projectId?: string | null;
  context?: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY">;
  schedule?: TaskScheduleSelection;
  relation: UserWritableTaskLinkRelation;
  note?: string | null;
  replaceExistingParent?: boolean;
}

function isClientCoreApiError(error: unknown): error is CoreApiRequestError {
  return (
    error instanceof CoreApiRequestError &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401
  );
}

function rethrowTaskActionError(
  error: unknown,
  fallbackMessage: string,
  logLabel: string,
): never {
  console.error(logLabel, error);

  if (isClientCoreApiError(error)) {
    throw error;
  }

  const { message } = toCoreApiActionError(error);
  throw new Error(message ?? fallbackMessage);
}

async function applyTaskSchedule(
  taskId: string,
  schedule: TaskScheduleSelection,
  hadSchedule: boolean,
): Promise<TaskStatus | null> {
  if (schedule.mode === "none") {
    if (hadSchedule) {
      const task = await taskScheduleService.clearSchedule(taskId);
      return task.status;
    }
    return null;
  }

  const body = selectionToApiBody(schedule);
  if (!body) {
    throw new Error("Invalid schedule");
  }

  const task = await taskScheduleService.setSchedule(taskId, body);
  return task.status;
}

function resolveUpdateTargetStatus(
  desiredStatus: TaskStatus,
  statusAfterSchedule: TaskStatus,
  scheduleWasMutated: boolean,
  scheduleActiveOnServer: boolean,
): TaskStatus {
  if (scheduleWasMutated) {
    if (scheduleActiveOnServer) {
      return statusAfterSchedule;
    }

    if (desiredStatus === TaskStatus.QUEUED) {
      return statusAfterSchedule;
    }

    return desiredStatus;
  }

  if (scheduleActiveOnServer && desiredStatus !== TaskStatus.QUEUED) {
    return statusAfterSchedule;
  }

  return desiredStatus;
}

function resolveCreateStatus(
  requestedStatus: Extract<TaskStatus, "DRAFT" | "READY">,
  schedule?: TaskScheduleSelection,
): Extract<TaskStatus, "DRAFT" | "READY"> {
  if (!schedule || schedule.mode === "none") {
    return requestedStatus;
  }

  return TaskStatus.DRAFT;
}

function normalizeLinkNote(note?: string | null): string | null | undefined {
  if (typeof note === "undefined") {
    return undefined;
  }

  const trimmedNote = note?.trim();
  return trimmedNote ? trimmedNote : null;
}

function revalidateTaskMutationRoutes(taskId: string, relatedTaskId?: string) {
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);

  if (relatedTaskId) {
    revalidatePath(`/tasks/${relatedTaskId}`);
  }
}

function revalidateCalendarTaskMutationRoutes(task: Task) {
  revalidatePath("/calendar");
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${task.id}`);

  if (task.projectId) {
    revalidatePath(`/projects/${task.projectId}/calendar`);
  }
}

function getActiveScheduleBody(schedule: TaskScheduleSelection) {
  if (schedule.mode === "none") {
    throw new Error("Active schedule required");
  }

  const body = selectionToApiBody(schedule);
  if (!body) {
    throw new Error("Invalid schedule");
  }

  return body;
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

function toCoreTaskContext(
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

    return {
      brand: {
        url: resolveDesignMdAttachmentUrl(selection.brand.custom.url, userId),
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

function resolveAssigneeWrite(
  assigneeId?: string | null,
  assigneeSokoBotId?: string | null,
): { assigneeId: string | null; assigneeSokoBotId: string | null } {
  const sokoBotId = assigneeSokoBotId?.trim() || null;
  if (sokoBotId) {
    return { assigneeId: null, assigneeSokoBotId: sokoBotId };
  }

  return {
    assigneeId: assigneeId?.trim() ? assigneeId : null,
    assigneeSokoBotId: null,
  };
}

async function createTaskFromDescription(input: {
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  projectId?: string | null;
  userId: string;
  context?: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY">;
  schedule?: TaskScheduleSelection;
}): Promise<Task> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) {
    throw new Error("Description required");
  }

  const normalizedProjectId = normalizeOptionalProjectId(input.projectId);
  const context = input.context
    ? toCoreTaskContext(input.context, input.userId)
    : undefined;

  const task = await taskService.createTask({
    description: trimmedDescription,
    ...resolveAssigneeWrite(input.assigneeId, input.assigneeSokoBotId),
    projectId: normalizedProjectId ?? null,
    ...(context ? { context } : {}),
    status: resolveCreateStatus(input.status, input.schedule),
  });

  try {
    if (
      input.status !== TaskStatus.DRAFT &&
      input.schedule &&
      input.schedule.mode !== "none"
    ) {
      await applyTaskSchedule(task.id, input.schedule, false);
    }
    return task;
  } catch (error) {
    await archiveCreatedTaskAfterFailure(task.id);
    throw error;
  }
}

async function collectParentLinksToReplace(input: {
  taskId: string;
  nextParentTaskId: string;
  relation: UserWritableTaskLinkRelation;
  replaceExistingParent?: boolean;
}): Promise<TaskLink[]> {
  const shouldReplaceParent =
    input.relation === TaskLinkRelation.CHILD &&
    input.replaceExistingParent !== false;

  if (!shouldReplaceParent) {
    return [];
  }

  const links = await taskService.listTaskLinks(input.taskId);
  return links.filter(
    (link) =>
      link.relation === "child" && link.peerTask.id !== input.nextParentTaskId,
  );
}

async function restoreParentLinks(
  taskId: string,
  parentLinks: TaskLink[],
): Promise<void> {
  for (const parentLink of parentLinks) {
    await taskService.createTaskLink(taskId, {
      toTaskId: parentLink.peerTask.id,
      relation: "child",
      note: parentLink.note,
    });
  }
}

async function rollbackCreatedParentLink(input: {
  taskId: string;
  createdLinkId: string;
  deletedParentLinks: TaskLink[];
}): Promise<void> {
  const rollbackFailures: string[] = [];

  try {
    await taskService.deleteTaskLink(input.taskId, input.createdLinkId);
  } catch (rollbackError) {
    console.error("Failed to rollback created parent link", rollbackError);
    rollbackFailures.push(
      rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError),
    );
  }

  try {
    await restoreParentLinks(input.taskId, input.deletedParentLinks);
  } catch (rollbackError) {
    console.error("Failed to restore previous parent links", rollbackError);
    rollbackFailures.push(
      rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError),
    );
  }

  if (rollbackFailures.length > 0) {
    throw new Error(
      `Task links may be inconsistent after a failed parent replacement. Rollback failed: ${rollbackFailures.join("; ")}`,
    );
  }
}

async function deletePreviousParentLinks(input: {
  taskId: string;
  createdLinkId: string;
  parentLinksToReplace: TaskLink[];
}): Promise<void> {
  const deletedParentLinks: TaskLink[] = [];

  try {
    for (const parentLink of input.parentLinksToReplace) {
      await taskService.deleteTaskLink(input.taskId, parentLink.id);
      deletedParentLinks.push(parentLink);
    }
  } catch (error) {
    try {
      await rollbackCreatedParentLink({
        taskId: input.taskId,
        createdLinkId: input.createdLinkId,
        deletedParentLinks,
      });
    } catch (rollbackError) {
      const originalMessage =
        error instanceof Error ? error.message : String(error);
      const rollbackMessage =
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
      throw new Error(
        `${rollbackMessage} (while recovering from: ${originalMessage})`,
      );
    }
    throw error;
  }
}

async function archiveCreatedTaskAfterFailure(taskId: string): Promise<void> {
  try {
    await taskService.deleteTask(taskId);
  } catch (cleanupError) {
    console.error(
      "Failed to archive created task after link failure",
      cleanupError,
    );
  }
}

export const createTask = withSession<CreateTaskParameters, CreateTaskResult>(
  async ({
    description,
    assigneeId,
    assigneeSokoBotId,
    projectId,
    session,
    context,
    status,
    schedule,
  }) => {
    try {
      const task = await createTaskFromDescription({
        description,
        assigneeId,
        assigneeSokoBotId,
        projectId,
        userId: session.user.id,
        context,
        status,
        schedule,
      });

      revalidatePath("/tasks");
      revalidatePath("/projects");
      return taskMutationSuccess({ taskId: task.id, name: task.name });
    } catch (error) {
      if (isCalendarClientUpgradeRequired(error)) {
        return calendarClientUpgradeRequired();
      }
      rethrowTaskActionError(
        error,
        "Failed to create task",
        "Failed to create task",
      );
    }
  },
);

export const createScheduledTask = withSession<
  CreateScheduledTaskParameters,
  CreateScheduledTaskResult
>(
  async ({
    operationId,
    source,
    description,
    assigneeId,
    context,
    schedule,
    session,
  }) => {
    const trimmedAssigneeId = assigneeId.trim();
    const trimmedDescription = description?.trim();
    if (!isUuidString(operationId)) {
      throw new Error("Operation ID must be a UUID");
    }
    if (!trimmedAssigneeId) {
      throw new Error("Assignee required");
    }

    const scheduleBody = getActiveScheduleBody(schedule);

    try {
      const task = await taskService.createScheduledTask({
        operationId,
        source,
        ...(typeof description !== "undefined"
          ? { description: trimmedDescription || null }
          : {}),
        assigneeId: trimmedAssigneeId,
        ...(context
          ? { context: toCoreTaskContext(context, session.user.id) }
          : {}),
        schedule: scheduleBody,
      });
      revalidateCalendarTaskMutationRoutes(task);
      return taskMutationSuccess({ taskId: task.id, name: task.name });
    } catch (error) {
      if (isCalendarClientUpgradeRequired(error)) {
        return calendarClientUpgradeRequired();
      }
      rethrowTaskActionError(
        error,
        "Failed to create scheduled task",
        "Failed to create scheduled task",
      );
    }
  },
);

export const saveCalendarTaskSchedule = withSession<
  SaveTaskScheduleParameters,
  SaveTaskScheduleResult
>(async ({ taskId, schedule }) => {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    throw new Error("Task required");
  }

  const scheduleBody = getActiveScheduleBody(schedule);

  try {
    const task = await taskScheduleService.setCalendarSchedule(
      normalizedTaskId,
      scheduleBody,
    );
    revalidateCalendarTaskMutationRoutes(task);
    return taskMutationSuccess({ taskId: task.id });
  } catch (error) {
    if (isCalendarClientUpgradeRequired(error)) {
      return calendarClientUpgradeRequired();
    }
    rethrowTaskActionError(
      error,
      "Failed to save task schedule",
      "Failed to save task schedule",
    );
  }
});

export const clearTaskSchedule = withSession<
  ClearTaskScheduleParameters,
  ClearTaskScheduleResult
>(async ({ taskId }) => {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    throw new Error("Task required");
  }

  try {
    const task = await taskScheduleService.clearSchedule(normalizedTaskId);
    revalidateCalendarTaskMutationRoutes(task);
    return taskMutationSuccess({ taskId: task.id });
  } catch (error) {
    if (isCalendarClientUpgradeRequired(error)) {
      return calendarClientUpgradeRequired();
    }
    rethrowTaskActionError(
      error,
      "Failed to clear task schedule",
      "Failed to clear task schedule",
    );
  }
});

export const updateTask = withSession<UpdateTaskParameters, UpdateTaskResult>(
  async ({
    taskId,
    name,
    description,
    assigneeId,
    assigneeSokoBotId,
    projectId,
    currentStatus,
    desiredStatus,
    schedule,
    hadSchedule = false,
    originalSchedule,
  }) => {
    const trimmedDescription = description.trim();
    const trimmedName = normalizeTaskNameForCoreApi(name);
    if (!trimmedDescription) {
      throw new Error("Description required");
    }
    if (!trimmedName) {
      throw new Error("Name required");
    }

    try {
      const normalizedProjectId = normalizeOptionalProjectId(projectId);

      await taskService.patchTask(taskId, {
        name: trimmedName,
        description: trimmedDescription,
        ...resolveAssigneeWrite(assigneeId, assigneeSokoBotId),
        ...(typeof normalizedProjectId !== "undefined"
          ? { projectId: normalizedProjectId }
          : {}),
      });

      let statusAfterSchedule = currentStatus;
      let scheduleActiveOnServer = hadSchedule || schedule?.mode !== "none";
      const scheduleChanged =
        schedule &&
        hasTaskScheduleChanged(
          originalSchedule ?? { mode: "none", timezone: "UTC" },
          schedule,
          hadSchedule,
        );

      const shouldClearScheduleForStatusChange =
        !scheduleChanged &&
        schedule &&
        schedule.mode !== "none" &&
        desiredStatus !== TaskStatus.QUEUED &&
        desiredStatus !== currentStatus;

      let scheduleWasMutated = false;

      if (shouldClearScheduleForStatusChange) {
        scheduleWasMutated = true;
        const scheduleStatus = await applyTaskSchedule(
          taskId,
          { mode: "none", timezone: schedule.timezone },
          true,
        );
        if (scheduleStatus !== null) {
          statusAfterSchedule = scheduleStatus;
        }
        scheduleActiveOnServer = false;
      }

      if (schedule && scheduleChanged) {
        scheduleWasMutated = true;
        const scheduleStatus = await applyTaskSchedule(
          taskId,
          schedule,
          hadSchedule,
        );
        if (scheduleStatus !== null) {
          statusAfterSchedule = scheduleStatus;
        }
        scheduleActiveOnServer = schedule.mode !== "none";
      }

      const targetStatus = resolveUpdateTargetStatus(
        desiredStatus,
        statusAfterSchedule,
        scheduleWasMutated,
        scheduleActiveOnServer,
      );

      if (targetStatus !== statusAfterSchedule) {
        await taskService.createTaskEvent(taskId, {
          status: targetStatus,
        });
      }

      revalidatePath("/tasks");
      revalidatePath(`/tasks/${taskId}`);
      if (typeof normalizedProjectId !== "undefined") {
        revalidatePath("/projects");
      }
      return taskMutationSuccess({ taskId });
    } catch (error) {
      if (isCalendarClientUpgradeRequired(error)) {
        return calendarClientUpgradeRequired();
      }
      rethrowTaskActionError(
        error,
        "Failed to update task",
        "Failed to update task",
      );
    }
  },
);

export const setTaskStatusFromDrag = withSession<
  SetTaskStatusFromDragParameters,
  SetTaskStatusResult
>(async ({ taskId, desiredStatus, comment }) => {
  try {
    const task = await taskService.getTaskById(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const currentStatus = task.status as TaskStatus;
    let statusAfterSchedule = currentStatus;

    const shouldClearSchedule =
      currentStatus === TaskStatus.QUEUED &&
      desiredStatus !== TaskStatus.QUEUED &&
      hasActiveTaskSchedule(task.metadata, task.nextRunAt);

    if (shouldClearSchedule) {
      const clearedTask = await taskScheduleService.clearSchedule(taskId);
      statusAfterSchedule = clearedTask.status as TaskStatus;
    }

    if (desiredStatus !== statusAfterSchedule) {
      const trimmedComment = comment?.trim();
      if (
        userTaskStatusTransitionRequiresComment(
          statusAfterSchedule,
          desiredStatus,
        ) &&
        !trimmedComment
      ) {
        throw new Error(
          "A comment is required when reopening a canceled or completed task to ready",
        );
      }

      await taskService.createTaskEvent(taskId, {
        status: desiredStatus,
        ...(trimmedComment ? { comment: trimmedComment } : {}),
      });
    }

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
    return taskMutationSuccess({ taskId });
  } catch (error) {
    if (isCalendarClientUpgradeRequired(error)) {
      return calendarClientUpgradeRequired();
    }
    rethrowTaskActionError(
      error,
      "Failed to update task status",
      "Failed to update task status",
    );
  }
});

export const deleteTask = withSession<DeleteTaskParameters, { taskId: string }>(
  async ({ taskId }) => {
    try {
      await taskService.deleteTask(taskId);
      revalidatePath("/tasks");
      revalidatePath(`/tasks/${taskId}`);
      return { taskId };
    } catch (error) {
      rethrowTaskActionError(
        error,
        "Failed to delete task",
        "Failed to delete task",
      );
    }
  },
);

export const moveTaskToWorkspace = withSession<
  MoveTaskToWorkspaceParameters,
  { taskId: string }
>(async ({ taskId, organizationId }) => {
  try {
    await taskService.moveTaskToWorkspace(taskId, organizationId);
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
    return { taskId };
  } catch (error) {
    rethrowTaskActionError(
      error,
      "Failed to move task to workspace",
      "Failed to move task to workspace",
    );
  }
});

export const createTaskComment = withSession<CreateTaskCommentParameters, void>(
  async ({ taskId, comment }) => {
    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      return;
    }

    try {
      await taskService.createTaskEvent(taskId, {
        comment: trimmedComment,
      });
      revalidatePath("/tasks");
      revalidatePath(`/tasks/${taskId}`);
    } catch (error) {
      rethrowTaskActionError(
        error,
        "Failed to create task comment",
        "Failed to create task comment",
      );
    }
  },
);

export const createTaskLink = withSession<
  CreateTaskLinkParameters,
  { taskId: string; linkId: string; relatedTaskId: string }
>(async ({ taskId, relatedTaskId, relation, note, replaceExistingParent }) => {
  const normalizedTaskId = taskId.trim();
  const normalizedRelatedTaskId = relatedTaskId.trim();
  if (!normalizedTaskId || !normalizedRelatedTaskId) {
    throw new Error("Task required");
  }

  try {
    const parentLinksToReplace = await collectParentLinksToReplace({
      taskId: normalizedTaskId,
      nextParentTaskId: normalizedRelatedTaskId,
      relation,
      replaceExistingParent,
    });

    const link = await taskService.createTaskLink(normalizedTaskId, {
      toTaskId: normalizedRelatedTaskId,
      relation,
      note: normalizeLinkNote(note),
    });

    await deletePreviousParentLinks({
      taskId: normalizedTaskId,
      createdLinkId: link.id,
      parentLinksToReplace,
    });

    revalidateTaskMutationRoutes(normalizedTaskId, normalizedRelatedTaskId);
    return {
      taskId: normalizedTaskId,
      relatedTaskId: normalizedRelatedTaskId,
      linkId: link.id,
    };
  } catch (error) {
    rethrowTaskActionError(
      error,
      "Failed to create task link",
      "Failed to create task link",
    );
  }
});

export const deleteTaskLink = withSession<
  DeleteTaskLinkParameters,
  { taskId: string; linkId: string; relatedTaskId?: string }
>(async ({ taskId, linkId }) => {
  const normalizedTaskId = taskId.trim();
  const normalizedLinkId = linkId.trim();
  if (!normalizedTaskId || !normalizedLinkId) {
    throw new Error("Task link required");
  }

  try {
    const taskLinks = await taskService.listTaskLinks(normalizedTaskId);
    const link = taskLinks.find(
      (candidate) => candidate.id === normalizedLinkId,
    );

    await taskService.deleteTaskLink(normalizedTaskId, normalizedLinkId);
    revalidateTaskMutationRoutes(normalizedTaskId, link?.peerTask.id);

    return {
      taskId: normalizedTaskId,
      linkId: normalizedLinkId,
      relatedTaskId: link?.peerTask.id,
    };
  } catch (error) {
    rethrowTaskActionError(
      error,
      "Failed to delete task link",
      "Failed to delete task link",
    );
  }
});

export const createTaskAndLink = withSession<
  CreateAndLinkTaskParameters,
  CreateTaskAndLinkResult
>(
  async ({
    taskId,
    description,
    assigneeId,
    assigneeSokoBotId,
    projectId,
    session,
    status,
    context,
    schedule,
    relation,
    note,
    replaceExistingParent,
  }) => {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      throw new Error("Task required");
    }

    let createdTask: Task | null = null;

    try {
      createdTask = await createTaskFromDescription({
        description,
        assigneeId,
        assigneeSokoBotId,
        projectId,
        userId: session.user.id,
        context,
        status,
        schedule,
      });

      const parentLinksToReplace = await collectParentLinksToReplace({
        taskId: normalizedTaskId,
        nextParentTaskId: createdTask.id,
        relation,
        replaceExistingParent,
      });

      const link = await taskService.createTaskLink(normalizedTaskId, {
        toTaskId: createdTask.id,
        relation,
        note: normalizeLinkNote(note),
      });

      await deletePreviousParentLinks({
        taskId: normalizedTaskId,
        createdLinkId: link.id,
        parentLinksToReplace,
      });

      revalidateTaskMutationRoutes(normalizedTaskId, createdTask.id);
      return taskMutationSuccess({
        taskId: normalizedTaskId,
        createdTaskId: createdTask.id,
        linkId: link.id,
        name: createdTask.name,
      });
    } catch (error) {
      if (createdTask) {
        await archiveCreatedTaskAfterFailure(createdTask.id);
      }
      if (isCalendarClientUpgradeRequired(error)) {
        return calendarClientUpgradeRequired();
      }
      rethrowTaskActionError(
        error,
        "Failed to create and link task",
        "Failed to create and link task",
      );
    }
  },
);
