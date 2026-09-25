import { z } from "@hono/zod-openapi";
import { type TaskSchedule, TaskScheduleEndsMode } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { isLegacyTaskScheduleShimEnabled } from "@/config/env";
import {
  forbidden,
  formatZodErrorMessage,
  gone,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import {
  migratedTaskScheduleId,
  shimCreateOperationId,
} from "@/helpers/legacy-task-schedule-id";
import { requireTaskNotParked } from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  type LegacyCreateScheduledTaskRequest,
  type LegacyPutCalendarSourceRequest,
  type LegacyTaskScheduleInput,
  legacyEndsModeFromTaskSchedule,
  legacyTaskScheduleProjectionSchema,
} from "@/schemas/legacy-task-schedule.schema";
import {
  type CreateTaskScheduleRequest,
  createTaskScheduleRequestSchema,
  type TaskScheduleRule,
  taskScheduleRuleReplacementSchema,
  type UpdateTaskScheduleRequest,
} from "@/schemas/task-schedule.schema";
import {
  canWriteTaskSchedule,
  type TaskScheduleReader,
} from "@/services/task-schedule.service";

const NEW_CREATE = "POST /v1/tasks/schedules";
const NEW_PATCH = "PATCH /v1/tasks/schedules/{id}";
const NEW_TASK_CREATE = "POST /v1/tasks";
const SHIM_SUNSET = "2026-09-29";

const ENDS_MODE_TO_NEW = {
  never: TaskScheduleEndsMode.NEVER,
  on: TaskScheduleEndsMode.ON,
  after: TaskScheduleEndsMode.AFTER,
} as const;

export function requireLegacyTaskScheduleShim(replacement: string): void {
  if (isLegacyTaskScheduleShimEnabled()) {
    return;
  }
  throw gone(
    `This route was removed. Repeating rules are Task Schedules: use ${replacement}. A one-time start is runAt on the Task. The temporary adapter was disabled (remove after ${SHIM_SUNSET}).`,
    {
      kind: CORE_API_ERROR_KINDS.TASK_SCHEDULE_MOVED,
      extensions: { replacement },
    },
  );
}

interface ShimLogTarget {
  get: (key: string) => unknown;
  var: {
    authContext?: AuthenticationContext | null;
    workspaceContext?: {
      workspaceId?: string;
      organizationId?: string | null;
    } | null;
  };
}

export function logLegacyTaskScheduleShimHit(
  c: ShimLogTarget,
  hit: { method: string; path: string; mappedTarget: string },
): void {
  const log = c.get("log") as
    | { set?: (value: Record<string, unknown>) => void }
    | undefined;
  const auth = c.var.authContext;
  const coworker = auth && isCoworkerAuthContext(auth) ? auth : null;
  const organizationId =
    coworker?.context?.organizationId ??
    (auth && auth.actor !== "coworker" ? auth.organizationId : null) ??
    c.var.workspaceContext?.organizationId ??
    null;
  log?.set?.({
    legacyTaskScheduleShim: {
      method: hit.method,
      path: hit.path,
      mappedTarget: hit.mappedTarget,
      coworkerId: coworker?.coworkerId ?? null,
      vendorId: coworker?.vendorId ?? null,
      organizationId,
      workspaceId: c.var.workspaceContext?.workspaceId ?? null,
    },
  });
}

function throwUnmappable(message: string, replacement: string): never {
  throw unprocessableEntity(message, {
    extensions: { replacement },
  });
}

/**
 * Route validation hook: with the shim off a bad body still answers 410, and
 * a body the old shape rejects answers 422 with the new route to use.
 */
export function legacyTaskScheduleShimValidationHook(replacement: string) {
  return (
    result: { target: string } & (
      | { success: true }
      | { success: false; error: z.ZodError }
    ),
  ): undefined => {
    if (result.success) {
      return undefined;
    }
    requireLegacyTaskScheduleShim(replacement);
    if (result.target === "json") {
      throwUnmappable(
        `${formatZodErrorMessage(result.error)}. Use ${replacement} with a typed rule.`,
        replacement,
      );
    }
    defaultValidationHook(result);
    return undefined;
  };
}

type LegacyRecurringSchedule = Extract<
  LegacyTaskScheduleInput,
  { mode: "recurring" }
>;

/**
 * Old `occurrences` counted the Runs still to come from the rule write on,
 * while `targetRunCount` counts every Run the schedule releases.
 */
function mapRecurringRule(
  schedule: LegacyRecurringSchedule,
  releasedCount = 0,
): TaskScheduleRule {
  const endsMode = ENDS_MODE_TO_NEW[schedule.endsMode];
  return {
    expr: schedule.expr,
    timezone: schedule.timezone,
    intervalDays: schedule.intervalDays,
    anchorAt: schedule.anchorAt,
    endsMode,
    endsOn: endsMode === TaskScheduleEndsMode.ON ? schedule.endsOn : undefined,
    targetRunCount:
      endsMode === TaskScheduleEndsMode.AFTER && schedule.occurrences != null
        ? releasedCount + schedule.occurrences
        : undefined,
  };
}

function remainingOccurrences(schedule: TaskSchedule): number | null {
  return schedule.targetRunCount == null
    ? null
    : schedule.targetRunCount - schedule.releasedCount;
}

export function requireRecurringSchedule(
  schedule: LegacyTaskScheduleInput,
): asserts schedule is LegacyRecurringSchedule {
  if (schedule.mode === "once") {
    throwUnmappable(
      `A one-time start is runAt on ${NEW_TASK_CREATE} or PATCH /v1/tasks/{id}, not a Task Schedule. Repeating rules belong on ${NEW_CREATE}.`,
      NEW_TASK_CREATE,
    );
  }
}

function rejectPersonAssignee(
  assigneeUserId: string | null | undefined,
  replacement: string,
): void {
  if (assigneeUserId != null) {
    throwUnmappable(
      `Task Schedules cannot be assigned to workspace members. Send assigneeId (Coworker) or assigneeSokoBotId on ${replacement}.`,
      replacement,
    );
  }
}

function parseMappedCreate(
  input: CreateTaskScheduleRequest,
): CreateTaskScheduleRequest {
  const parsed = createTaskScheduleRequestSchema.safeParse(input);
  if (!parsed.success) {
    throwUnmappable(
      `${formatZodErrorMessage(parsed.error)}. Use the typed rule on ${NEW_CREATE}.`,
      NEW_CREATE,
    );
  }
  return parsed.data;
}

function parseMappedRuleReplacement(rule: TaskScheduleRule): TaskScheduleRule {
  const parsed = taskScheduleRuleReplacementSchema.safeParse(rule);
  if (!parsed.success) {
    throwUnmappable(
      `${formatZodErrorMessage(parsed.error)}. Use the typed rule on ${NEW_PATCH}.`,
      NEW_PATCH,
    );
  }
  return parsed.data;
}

export function mapLegacyCreateToTaskSchedule(
  body: LegacyCreateScheduledTaskRequest,
): CreateTaskScheduleRequest {
  requireRecurringSchedule(body.schedule);
  rejectPersonAssignee(body.assigneeUserId, NEW_CREATE);
  return parseMappedCreate({
    operationId: body.operationId,
    name: body.name,
    description: body.description,
    projectId: body.source.type === "project" ? body.source.projectId : null,
    assigneeId: body.assigneeId,
    assigneeSokoBotId: body.assigneeSokoBotId,
    rule: mapRecurringRule(body.schedule),
  });
}

function sameInstant(
  a: string | Date | null | undefined,
  b: string | Date | null | undefined,
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * The old PUT kept the rule, its epoch, and its exceptions when the body
 * matched it, so a client re-sending its rule changed nothing.
 */
export function legacyRuleMatches(
  current: TaskSchedule,
  schedule: LegacyRecurringSchedule,
): boolean {
  const rule = mapRecurringRule(schedule);
  const intervalDays = rule.intervalDays ?? null;
  return (
    rule.expr === current.expr &&
    rule.timezone === current.timezone &&
    rule.endsMode === current.endsMode &&
    sameInstant(rule.endsOn, current.endsOn) &&
    (rule.targetRunCount ?? null) === remainingOccurrences(current) &&
    intervalDays === current.intervalDays &&
    (intervalDays == null ||
      intervalDays <= 1 ||
      sameInstant(rule.anchorAt, current.anchorAt))
  );
}

/** A rule replacement; the old PUT sent no revision, so it takes the current one. */
export function mapLegacyRuleToUpdate(
  schedule: LegacyRecurringSchedule,
  current: TaskSchedule,
  expectedRevision = current.revision,
): UpdateTaskScheduleRequest {
  return {
    expectedRevision,
    rule: parseMappedRuleReplacement(
      mapRecurringRule(schedule, current.releasedCount),
    ),
  };
}

export function mapLegacyCalendarSourceToUpdate(
  body: LegacyPutCalendarSourceRequest,
): UpdateTaskScheduleRequest {
  return {
    expectedRevision: body.expectedScheduleRevision,
    projectId: body.source.type === "project" ? body.source.projectId : null,
  };
}

export function mapTaskScheduleToLegacyProjection(schedule: TaskSchedule) {
  const endsMode = legacyEndsModeFromTaskSchedule(schedule.endsMode);
  return legacyTaskScheduleProjectionSchema.parse({
    id: schedule.id,
    scheduleId: schedule.id,
    name: schedule.name,
    description: schedule.description,
    projectId: schedule.projectId,
    visibility: schedule.visibility,
    assigneeId: schedule.assigneeId,
    assigneeSokoBotId: schedule.assigneeSokoBotId,
    nextRunAt: schedule.nextRunAt,
    scheduleRevision: schedule.revision,
    schedule: {
      mode: "recurring",
      expr: schedule.expr,
      timezone: schedule.timezone,
      endsMode,
      endsOn: schedule.endsOn,
      occurrences: remainingOccurrences(schedule),
      intervalDays: schedule.intervalDays,
      anchorAt: schedule.anchorAt,
    },
  });
}

const uuidSchema = z.guid();

/**
 * `{id}` is a Task Schedule id, a Task a Run released, a template Task the
 * cutover moved, or a Task this shim made a schedule from.
 */
export async function resolveTaskScheduleId(
  taskId: string,
): Promise<string | null> {
  // TaskSchedule.id is a Postgres uuid: any other id fails the cast.
  if (uuidSchema.safeParse(taskId).success) {
    const byScheduleId = await prisma.taskSchedule.findFirst({
      where: { id: taskId },
      select: { id: true },
    });
    if (byScheduleId) {
      return byScheduleId.id;
    }
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { scheduleId: true },
  });
  if (task?.scheduleId) {
    return task.scheduleId;
  }

  const migrated = await prisma.taskSchedule.findFirst({
    where: { id: migratedTaskScheduleId(taskId) },
    select: { id: true },
  });
  if (migrated) {
    return migrated.id;
  }

  const shimCreated = await prisma.taskScheduleCreateOperation.findFirst({
    where: { operationId: shimCreateOperationId(taskId) },
    select: { scheduleId: true },
  });
  return shimCreated?.scheduleId ?? null;
}

export async function requireResolvedTaskScheduleId(
  taskId: string,
): Promise<string> {
  const scheduleId = await resolveTaskScheduleId(taskId);
  if (!scheduleId) {
    throw notFound(
      "No Task Schedule is linked to this Task. Use GET /v1/tasks/schedules/{id} with the schedule id.",
    );
  }
  return scheduleId;
}

function scheduleWriter(vars: EnvVariables["Variables"]): TaskScheduleReader {
  const { authContext } = vars;
  const { userId } = requireUserContext(authContext);
  return isCoworkerAuthContext(authContext)
    ? {
        kind: "coworker",
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        userId,
      }
    : { kind: "user", userId };
}

/**
 * A PUT that re-sends the current rule writes nothing, but answers only a
 * caller that could have written it, as the update would.
 */
export async function requireLegacyScheduleWrite(
  vars: EnvVariables["Variables"],
  scheduleId: string,
): Promise<void> {
  const schedule = await prisma.taskSchedule.findFirst({
    where: { id: scheduleId },
    include: { assignee: { select: { vendorId: true } } },
  });
  if (!schedule || !canWriteTaskSchedule(scheduleWriter(vars), schedule)) {
    throw forbidden("Only the owner can change this Task Schedule");
  }
}

/**
 * The Task a PUT turns into a schedule. The schedule belongs to the acting
 * member, so the Task must too, and a Coworker must be one that may write the
 * schedule it becomes. The Task itself is left as it is.
 */
export async function requireTaskBlueprint(
  vars: EnvVariables["Variables"],
  taskId: string,
) {
  const writer = scheduleWriter(vars);
  const workspace = requireWorkspaceContext(vars.workspaceContext);
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      workspaceId: workspace.workspaceId,
      ownerId: writer.userId,
      archivedAt: null,
    },
    include: { assignee: { select: { vendorId: true } } },
  });
  if (!task) {
    throw notFound("Task not found");
  }
  requireTaskNotParked(task);
  if (!canWriteTaskSchedule(writer, task)) {
    throw forbidden(
      "Coworkers can only schedule the acting member's Tasks they created, are assigned to, or that are assigned to their vendor siblings",
    );
  }
  return task;
}

/**
 * The create is keyed on the Task, so a retry or a concurrent PUT replays
 * the first schedule instead of making a second.
 */
export function mapTaskBlueprintToCreate(
  task: Awaited<ReturnType<typeof requireTaskBlueprint>>,
  schedule: LegacyRecurringSchedule,
): CreateTaskScheduleRequest {
  rejectPersonAssignee(task.assigneeUserId, NEW_CREATE);
  if (!task.name?.trim()) {
    throwUnmappable(
      `The Task has no name. Use ${NEW_CREATE} with name and a typed rule.`,
      NEW_CREATE,
    );
  }
  return parseMappedCreate({
    operationId: shimCreateOperationId(task.id),
    name: task.name,
    description: task.description,
    projectId: task.projectId,
    visibility: task.visibility,
    assigneeId: task.assigneeId,
    assigneeSokoBotId: task.assigneeSokoBotId,
    rule: mapRecurringRule(schedule),
  });
}
