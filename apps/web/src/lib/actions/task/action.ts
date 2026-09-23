"use server";

import {
  buildAdHocDesignMdPrefix,
  CORE_API_ERROR_KINDS,
  hasActiveTaskSchedule,
  taskContextSelectionAttachesAnything,
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
  type CalendarTaskScheduleSource,
  type CreateScheduledTaskRequest,
  type CreateTaskContext,
  type Task,
  type TaskLink,
  TaskLinkRelation,
  TaskStatus,
  type UserWritableTaskLinkRelation,
} from "@/lib/clients/generated/core";
import { taskService } from "@/lib/services/task.service";
import {
  type TaskScheduleSeriesPrecondition,
  taskScheduleService,
} from "@/lib/services/task-schedule.service";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import { normalizeOptionalProjectId } from "@/lib/utils/project";
import {
  hasTaskScheduleChanged,
  selectionToApiBody,
} from "@/lib/utils/task-schedule";
import {
  TASK_MUTATION_ERROR_KINDS,
  type TaskMutationErrorKind,
} from "@/lib/utils/task-schedule-feedback";
import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";
import { isUuidString } from "@/lib/utils/uuid";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CreateTaskParameters extends AuthenticatedRequest {
  name?: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  context?: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
  schedule?: TaskScheduleSelection;
  visibility?: "PUBLIC" | "PRIVATE";
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
  assigneeUserId?: string | null;
  projectId?: string | null;
  context?: TaskContextSelectionInput;
  currentStatus: TaskStatus;
  desiredStatus: TaskStatus;
  schedule?: TaskScheduleSelection;
  hadSchedule?: boolean;
  /** Series revision the edit form was opened against; required once live. */
  expectedScheduleRevision?: number;
  /** Browser-minted identity of this save attempt; reused across retries. */
  scheduleOperationId?: string;
  originalSchedule?: TaskScheduleSelection;
}

interface CreateScheduledTaskParameters extends AuthenticatedRequest {
  operationId: string;
  source: CreateScheduledTaskRequest["source"];
  description?: string | null;
  assigneeId?: string | null;
  assigneeUserId?: string | null;
  context?: TaskContextSelectionInput;
  schedule: TaskScheduleSelection;
}

interface SaveTaskScheduleParameters
  extends AuthenticatedRequest,
    TaskScheduleSeriesPrecondition {
  taskId: string;
  schedule: TaskScheduleSelection;
}

interface ClearTaskScheduleParameters
  extends AuthenticatedRequest,
    TaskScheduleSeriesPrecondition {
  taskId: string;
}

interface MoveCalendarTaskSourceParameters
  extends AuthenticatedRequest,
    TaskScheduleSeriesPrecondition {
  taskId: string;
  source: CalendarTaskScheduleSource;
}

interface TaskOccurrenceMutationBase
  extends AuthenticatedRequest,
    TaskScheduleSeriesPrecondition {
  taskId: string;
  occurrenceId: string;
}

interface RescheduleTaskOccurrenceParameters
  extends TaskOccurrenceMutationBase {
  action: "reschedule";
  /** Absolute UTC instant the occurrence moves to, as an ISO string. */
  scheduledAt: string;
}

interface SkipTaskOccurrenceParameters extends TaskOccurrenceMutationBase {
  action: "skip";
}

interface RestoreTaskOccurrenceParameters extends TaskOccurrenceMutationBase {
  action: "restore";
  /** Omit to restore the occurrence to its original projected time. */
  scheduledAt?: string;
}

type MutateTaskOccurrenceParameters =
  | RescheduleTaskOccurrenceParameters
  | SkipTaskOccurrenceParameters
  | RestoreTaskOccurrenceParameters;

interface TaskMutationError {
  kind: TaskMutationErrorKind;
}

type TaskMutationActionResult<T> = ActionResultDto<T, TaskMutationError>;

export type CreateTaskResult = TaskMutationActionResult<{
  taskId: string;
  name: string;
}>;
type UpdateTaskResult = TaskMutationActionResult<{ taskId: string }>;
type SetTaskStatusResult = TaskMutationActionResult<{ taskId: string }>;
type CreateScheduledTaskResult = TaskMutationActionResult<{
  taskId: string;
  name: string;
}>;
type SaveTaskScheduleResult = TaskMutationActionResult<{
  taskId: string;
}>;
type ClearTaskScheduleResult = TaskMutationActionResult<{
  taskId: string;
}>;
type MoveCalendarTaskSourceResult = TaskMutationActionResult<{
  taskId: string;
  scheduleRevision: number;
}>;
type MutateTaskOccurrenceResult = TaskMutationActionResult<{
  taskId: string;
  scheduleRevision: number;
}>;
type CreateTaskAndLinkResult = TaskMutationActionResult<{
  taskId: string;
  createdTaskId: string;
  linkId: string;
  name: string;
}>;

function taskMutationSuccess<T>(value: T): TaskMutationActionResult<T> {
  return toActionResult(ok(value));
}

function taskMutationFailure<T>(
  kind: TaskMutationErrorKind,
): TaskMutationActionResult<T> {
  return toActionResult(err({ kind }));
}

function toTaskMutationErrorKind(error: unknown): TaskMutationErrorKind | null {
  if (!(error instanceof CoreApiRequestError)) {
    return null;
  }

  return TASK_MUTATION_ERROR_KINDS.find((kind) => kind === error.kind) ?? null;
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
  assigneeUserId?: string | null;
  projectId?: string | null;
  context?: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
  schedule?: TaskScheduleSelection;
  visibility?: "PUBLIC" | "PRIVATE";
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

/**
 * Arms a schedule on a Task that has none. There is no live series to
 * serialize against yet, so this is the one remaining legacy-contract write;
 * every change to a live series goes through the revision-safe path below.
 */
async function armTaskSchedule(
  taskId: string,
  schedule: TaskScheduleSelection,
): Promise<TaskStatus> {
  const task = await taskScheduleService.setSchedule(
    taskId,
    getActiveScheduleBody(schedule),
  );
  return task.status;
}

/**
 * Applies a change to a live series under the revision the caller observed.
 * The removal and the replacement are the same user operation from the UI's
 * point of view, so they share one operation identity.
 */
async function applyTaskSeriesChange(
  taskId: string,
  schedule: TaskScheduleSelection,
  precondition: TaskScheduleSeriesPrecondition,
): Promise<TaskStatus> {
  const task =
    schedule.mode === "none"
      ? await taskScheduleService.removeCalendarSeries(taskId, precondition)
      : await taskScheduleService.editCalendarSeries(
          taskId,
          precondition,
          getActiveScheduleBody(schedule),
        );
  return task.status;
}

function resolveUpdateTargetStatus(
  desiredStatus: TaskStatus,
  statusAfterSchedule: TaskStatus,
  scheduleWasMutated: boolean,
  scheduleActiveOnServer: boolean,
  isAgentAssignee: boolean,
): TaskStatus {
  if (scheduleWasMutated) {
    if (scheduleActiveOnServer) {
      // Schedule apply may land Ready. For agents, honor an explicit Queued
      // choice with a follow-up event. Humans stay on the schedule result.
      if (
        isAgentAssignee &&
        desiredStatus === TaskStatus.QUEUED &&
        statusAfterSchedule !== TaskStatus.QUEUED
      ) {
        return desiredStatus;
      }
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
  requestedStatus: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">,
  schedule?: TaskScheduleSelection,
): Extract<TaskStatus, "DRAFT" | "READY"> {
  if (!schedule || schedule.mode === "none") {
    return requestedStatus === TaskStatus.QUEUED
      ? TaskStatus.READY
      : requestedStatus;
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

function revalidateCalendarSourceMoveRoutes(
  taskId: string,
  projectIds: Array<string | null>,
) {
  revalidatePath("/calendar");
  revalidatePath("/projects");
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  for (const projectId of new Set(projectIds.filter(Boolean))) {
    revalidatePath(`/projects/${projectId}/calendar`);
  }
}

/**
 * A logical user operation owns one UUID, minted in the browser and reused
 * across retries so Core can replay it. Server actions never mint one — a
 * fresh identity per invocation would turn every retry into a new operation.
 */
function requireOperationId(operationId: string | undefined): string {
  if (!operationId || !isUuidString(operationId)) {
    throw new Error("Operation ID must be a UUID");
  }
  return operationId;
}

/**
 * A live series is only written with a revision Core actually reported. Sending
 * an invented one would be presented to the user as "someone else changed this
 * schedule", so a missing revision fails here instead.
 */
function requireScheduleRevision(revision: number | undefined): number {
  if (typeof revision !== "number") {
    throw new Error("Core returned no scheduleRevision for an active series");
  }
  return revision;
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

function resolveAssigneeWrite(
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

async function createTaskFromDescription(input: {
  name?: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  userId: string;
  context?: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
  schedule?: TaskScheduleSelection;
  visibility?: "PUBLIC" | "PRIVATE";
}): Promise<Task> {
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
  const isAgentAssignee =
    assigneeWrite.assigneeId != null || assigneeWrite.assigneeSokoBotId != null;
  if (
    input.status !== TaskStatus.DRAFT &&
    !isAgentAssignee &&
    input.schedule &&
    input.schedule.mode !== "none"
  ) {
    throw new Error("Schedules require an agent assignee");
  }

  const trimmedName = input.name
    ? normalizeTaskNameForCoreApi(input.name)
    : undefined;

  const task = await taskService.createTask({
    description: trimmedDescription,
    ...assigneeWrite,
    projectId: normalizedProjectId ?? null,
    ...(context ? { context } : {}),
    status: resolveCreateStatus(input.status, input.schedule),
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(trimmedName ? { name: trimmedName } : {}),
  });

  try {
    if (
      input.status !== TaskStatus.DRAFT &&
      input.schedule &&
      input.schedule.mode !== "none"
    ) {
      const statusAfterSchedule = await armTaskSchedule(
        task.id,
        input.schedule,
      );
      // Create always goes Draft → schedule. Agents that asked for Queued but
      // landed Ready need a follow-up event.
      if (
        isAgentAssignee &&
        input.status === TaskStatus.QUEUED &&
        statusAfterSchedule != null &&
        statusAfterSchedule !== TaskStatus.QUEUED
      ) {
        await taskService.createTaskEvent(task.id, {
          status: TaskStatus.QUEUED,
        });
      }
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
    name,
    description,
    assigneeId,
    assigneeSokoBotId,
    assigneeUserId,
    projectId,
    session,
    context,
    status,
    schedule,
    visibility,
  }) => {
    try {
      const task = await createTaskFromDescription({
        ...(name ? { name } : {}),
        description,
        assigneeId,
        assigneeSokoBotId,
        assigneeUserId,
        projectId,
        userId: session.user.id,
        context,
        status,
        schedule,
        visibility,
      });

      revalidatePath("/tasks");
      revalidatePath("/projects");
      return taskMutationSuccess({ taskId: task.id, name: task.name });
    } catch (error) {
      const mutationErrorKind = toTaskMutationErrorKind(error);
      if (mutationErrorKind) {
        return taskMutationFailure(mutationErrorKind);
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
    assigneeUserId,
    context,
    schedule,
    session,
  }) => {
    const trimmedAssigneeId = assigneeId?.trim() || null;
    const trimmedAssigneeUserId = assigneeUserId?.trim() || null;
    const trimmedDescription = description?.trim();
    requireOperationId(operationId);
    if (!trimmedAssigneeId || trimmedAssigneeUserId) {
      throw new Error("Exactly one assignee is required");
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
      const mutationErrorKind = toTaskMutationErrorKind(error);
      if (mutationErrorKind) {
        return taskMutationFailure(mutationErrorKind);
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
>(async ({ taskId, operationId, expectedScheduleRevision, schedule }) => {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    throw new Error("Task required");
  }
  requireOperationId(operationId);

  const scheduleBody = getActiveScheduleBody(schedule);

  try {
    const task = await taskScheduleService.editCalendarSeries(
      normalizedTaskId,
      { operationId, expectedScheduleRevision },
      scheduleBody,
    );
    revalidateCalendarTaskMutationRoutes(task);
    return taskMutationSuccess({ taskId: task.id });
  } catch (error) {
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
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
>(async ({ taskId, operationId, expectedScheduleRevision }) => {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    throw new Error("Task required");
  }
  requireOperationId(operationId);

  try {
    const task = await taskScheduleService.removeCalendarSeries(
      normalizedTaskId,
      { operationId, expectedScheduleRevision },
    );
    revalidateCalendarTaskMutationRoutes(task);
    return taskMutationSuccess({ taskId: task.id });
  } catch (error) {
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
    }
    rethrowTaskActionError(
      error,
      "Failed to clear task schedule",
      "Failed to clear task schedule",
    );
  }
});

export const moveCalendarTaskSource = withSession<
  MoveCalendarTaskSourceParameters,
  MoveCalendarTaskSourceResult
>(async ({ taskId, operationId, expectedScheduleRevision, source }) => {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    throw new Error("Task required");
  }
  requireOperationId(operationId);

  try {
    const result = await taskScheduleService.moveCalendarSeriesSource(
      normalizedTaskId,
      { operationId, expectedScheduleRevision },
      source,
    );
    revalidateCalendarSourceMoveRoutes(normalizedTaskId, [
      result.previousSource.type === "project"
        ? result.previousSource.projectId
        : null,
      result.source.type === "project" ? result.source.projectId : null,
    ]);
    return taskMutationSuccess({
      taskId: normalizedTaskId,
      scheduleRevision: result.scheduleRevision,
    });
  } catch (error) {
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
    }
    rethrowTaskActionError(
      error,
      "Failed to move Calendar task source",
      "Failed to move Calendar task source",
    );
  }
});

export const mutateTaskOccurrence = withSession<
  MutateTaskOccurrenceParameters,
  MutateTaskOccurrenceResult
>(async (parameters) => {
  const { taskId, occurrenceId, operationId, expectedScheduleRevision } =
    parameters;
  const normalizedTaskId = taskId.trim();
  const normalizedOccurrenceId = occurrenceId.trim();
  if (!normalizedTaskId) {
    throw new Error("Task required");
  }
  if (!normalizedOccurrenceId) {
    throw new Error("Occurrence required");
  }
  requireOperationId(operationId);

  try {
    const task = await taskService.getTaskById(normalizedTaskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const mutation =
      parameters.action === "reschedule"
        ? {
            action: parameters.action,
            scheduledAt: new Date(parameters.scheduledAt),
          }
        : parameters.action === "restore" && parameters.scheduledAt
          ? {
              action: parameters.action,
              scheduledAt: new Date(parameters.scheduledAt),
            }
          : { action: parameters.action };
    const result = await taskScheduleService.mutateOccurrence(
      normalizedTaskId,
      normalizedOccurrenceId,
      {
        operationId,
        expectedScheduleRevision,
        ...mutation,
      },
    );
    revalidateCalendarTaskMutationRoutes(task);
    return taskMutationSuccess({
      taskId: normalizedTaskId,
      scheduleRevision: result.scheduleRevision,
    });
  } catch (error) {
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
    }
    rethrowTaskActionError(
      error,
      "Failed to change task occurrence",
      "Failed to change task occurrence",
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
    assigneeUserId,
    projectId,
    context,
    currentStatus,
    desiredStatus,
    schedule,
    hadSchedule = false,
    expectedScheduleRevision,
    scheduleOperationId,
    originalSchedule,
    session,
  }) => {
    const trimmedDescription = description.trim();
    const trimmedName = normalizeTaskNameForCoreApi(name);
    // Edit may strip Context links into an empty body; Core re-prepends from
    // `context`. Reject only when both the body and every Context chip are off.
    if (
      !trimmedDescription &&
      !(context && taskContextSelectionAttachesAnything(context))
    ) {
      throw new Error("Description required");
    }
    if (!trimmedName) {
      throw new Error("Name required");
    }

    try {
      const normalizedProjectId = normalizeOptionalProjectId(projectId);

      const assigneeWrite = resolveAssigneeWrite(
        assigneeId,
        assigneeSokoBotId,
        assigneeUserId,
      );
      if (
        !assigneeWrite.assigneeId &&
        !assigneeWrite.assigneeSokoBotId &&
        schedule &&
        schedule.mode !== "none" &&
        (!hadSchedule ||
          hasTaskScheduleChanged(
            originalSchedule ?? { mode: "none", timezone: "UTC" },
            schedule,
            hadSchedule,
          ))
      ) {
        throw new Error("Schedules require an agent assignee");
      }
      // While a series is live, field edits take the same revision as release,
      // so Core rejects an edit written against a revision the release already
      // moved past.
      const patchedTask = await taskService.patchTask(taskId, {
        name: trimmedName,
        description: trimmedDescription,
        ...assigneeWrite,
        ...(typeof normalizedProjectId !== "undefined"
          ? { projectId: normalizedProjectId }
          : {}),
        ...(context
          ? { context: toCoreTaskContext(context, session.user.id) }
          : {}),
        ...(hadSchedule ? { expectedScheduleRevision } : {}),
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
      let scheduleWasMutated = false;

      if (schedule && scheduleChanged) {
        scheduleWasMutated = true;
        // The field edit above incremented the revision, so the schedule write
        // in this same user operation must send the value it returned.
        statusAfterSchedule = hadSchedule
          ? await applyTaskSeriesChange(taskId, schedule, {
              operationId: requireOperationId(scheduleOperationId),
              expectedScheduleRevision: requireScheduleRevision(
                patchedTask.scheduleRevision ?? expectedScheduleRevision,
              ),
            })
          : await armTaskSchedule(taskId, schedule);
        scheduleActiveOnServer = schedule.mode !== "none";
      }

      const isAgentAssignee =
        assigneeWrite.assigneeId != null ||
        assigneeWrite.assigneeSokoBotId != null;
      const targetStatus = resolveUpdateTargetStatus(
        desiredStatus,
        statusAfterSchedule,
        scheduleWasMutated,
        scheduleActiveOnServer,
        isAgentAssignee,
      );

      if (targetStatus !== statusAfterSchedule) {
        await taskService.createTaskEvent(taskId, {
          status: targetStatus,
        });
      }

      if (scheduleWasMutated) {
        // Already covers both Task routes, plus the Calendar ones.
        revalidateCalendarTaskMutationRoutes(patchedTask);
      } else {
        revalidatePath("/tasks");
        revalidatePath(`/tasks/${taskId}`);
      }
      if (typeof normalizedProjectId !== "undefined") {
        revalidatePath("/projects");
      }
      return taskMutationSuccess({ taskId });
    } catch (error) {
      const mutationErrorKind = toTaskMutationErrorKind(error);
      if (mutationErrorKind) {
        return taskMutationFailure(mutationErrorKind);
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

    if (desiredStatus !== currentStatus) {
      // A live series owns this Task's status. Dropping it in another column
      // used to silently unschedule it; the drag is now refused so the user
      // decides what happens to the series. Ready → Queued is the one move
      // Core still accepts (selectableStatuses / events).
      if (
        hasActiveTaskSchedule(task.metadata, task.nextRunAt) &&
        !(
          currentStatus === TaskStatus.READY &&
          desiredStatus === TaskStatus.QUEUED
        )
      ) {
        return taskMutationFailure(CORE_API_ERROR_KINDS.SCHEDULE_ACTIVE);
      }

      const trimmedComment = comment?.trim();
      if (
        userTaskStatusTransitionRequiresComment(currentStatus, desiredStatus) &&
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
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
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
    assigneeUserId,
    projectId,
    session,
    status,
    context,
    schedule,
    visibility,
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
        assigneeUserId,
        projectId,
        userId: session.user.id,
        context,
        status,
        schedule,
        visibility,
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
      const mutationErrorKind = toTaskMutationErrorKind(error);
      if (mutationErrorKind) {
        return taskMutationFailure(mutationErrorKind);
      }
      rethrowTaskActionError(
        error,
        "Failed to create and link task",
        "Failed to create and link task",
      );
    }
  },
);
