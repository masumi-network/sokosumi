import { type TaskSchedule, TaskScheduleEndsMode } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { isLegacyTaskScheduleShimEnabled } from "@/config/env";
import {
  formatZodErrorMessage,
  gone,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import {
  migratedTaskScheduleId,
  shimCreatedTaskScheduleId,
} from "@/helpers/legacy-task-schedule-id";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
} from "@/middleware/auth";
import {
  type LegacyCreateScheduledTaskRequest,
  type LegacyPutCalendarSourceRequest,
  type LegacyPutCalendarTaskScheduleRequest,
  type LegacyTaskScheduleInput,
  legacyCreateScheduledTaskRequestSchema,
  legacyEndsModeFromTaskSchedule,
  legacyPutCalendarSourceRequestSchema,
  legacyPutCalendarTaskScheduleRequestSchema,
  legacyPutTaskScheduleRequestSchema,
  legacyTaskScheduleProjectionSchema,
} from "@/schemas/legacy-task-schedule.schema";
import {
  type CreateTaskScheduleRequest,
  createTaskScheduleRequestSchema,
  type TaskScheduleRule,
  taskScheduleRuleReplacementSchema,
  type UpdateTaskScheduleRequest,
} from "@/schemas/task-schedule.schema";

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
    workspaceContext?: { workspaceId?: string } | null;
  };
}

export function logLegacyTaskScheduleShimHit(
  c: ShimLogTarget,
  route: string,
): void {
  const log = c.get("log") as
    | { set?: (value: Record<string, unknown>) => void }
    | undefined;
  const auth = c.var.authContext;
  log?.set?.({
    legacyTaskScheduleShim: {
      route,
      workspaceId: c.var.workspaceContext?.workspaceId ?? null,
      vendorId: auth && isCoworkerAuthContext(auth) ? auth.vendorId : null,
    },
  });
}

function throwUnmappable(message: string, replacement: string): never {
  throw unprocessableEntity(message, {
    extensions: { replacement },
  });
}

function mapRecurringRule(
  schedule: Extract<LegacyTaskScheduleInput, { mode: "recurring" }>,
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
      endsMode === TaskScheduleEndsMode.AFTER
        ? schedule.occurrences
        : undefined,
  };
}

function rejectOnceOrPersonAssignee(
  schedule: LegacyTaskScheduleInput,
  assigneeUserId: string | null | undefined,
  replacement: string,
): asserts schedule is Extract<LegacyTaskScheduleInput, { mode: "recurring" }> {
  if (schedule.mode === "once") {
    throwUnmappable(
      `A one-time start is runAt on ${NEW_TASK_CREATE} or PATCH /v1/tasks/{id}, not a Task Schedule. Repeating rules belong on ${NEW_CREATE}.`,
      NEW_TASK_CREATE,
    );
  }
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

export function parseLegacyCreateBody(
  body: unknown,
): LegacyCreateScheduledTaskRequest {
  const parsed = legacyCreateScheduledTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    throwUnmappable(
      `${formatZodErrorMessage(parsed.error)}. Use ${NEW_CREATE} with a typed rule.`,
      NEW_CREATE,
    );
  }
  return parsed.data;
}

export function mapLegacyCreateToTaskSchedule(
  body: LegacyCreateScheduledTaskRequest,
): CreateTaskScheduleRequest {
  rejectOnceOrPersonAssignee(body.schedule, body.assigneeUserId, NEW_CREATE);
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

export function parseLegacyPutScheduleBody(
  body: unknown,
): Extract<LegacyTaskScheduleInput, { mode: "recurring" }> {
  const parsed = legacyPutTaskScheduleRequestSchema.safeParse(body);
  if (!parsed.success) {
    throwUnmappable(
      `${formatZodErrorMessage(parsed.error)}. Use ${NEW_PATCH} with a typed rule.`,
      NEW_PATCH,
    );
  }
  rejectOnceOrPersonAssignee(parsed.data, undefined, NEW_PATCH);
  return parsed.data;
}

export function mapLegacyPutScheduleToUpdate(
  schedule: LegacyTaskScheduleInput,
  expectedRevision: number,
): UpdateTaskScheduleRequest {
  rejectOnceOrPersonAssignee(schedule, undefined, NEW_PATCH);
  return {
    expectedRevision,
    rule: parseMappedRuleReplacement(mapRecurringRule(schedule)),
  };
}

export function parseLegacyCalendarScheduleBody(
  body: unknown,
): LegacyPutCalendarTaskScheduleRequest {
  const parsed = legacyPutCalendarTaskScheduleRequestSchema.safeParse(body);
  if (!parsed.success) {
    throwUnmappable(
      `${formatZodErrorMessage(parsed.error)}. Use ${NEW_PATCH} with expectedRevision and a typed rule.`,
      NEW_PATCH,
    );
  }
  rejectOnceOrPersonAssignee(parsed.data.schedule, undefined, NEW_PATCH);
  return parsed.data;
}

export function mapLegacyCalendarScheduleToUpdate(
  body: LegacyPutCalendarTaskScheduleRequest,
): UpdateTaskScheduleRequest {
  rejectOnceOrPersonAssignee(body.schedule, undefined, NEW_PATCH);
  return {
    expectedRevision: body.expectedScheduleRevision,
    rule: parseMappedRuleReplacement(mapRecurringRule(body.schedule)),
  };
}

export function parseLegacyCalendarSourceBody(
  body: unknown,
): LegacyPutCalendarSourceRequest {
  const parsed = legacyPutCalendarSourceRequestSchema.safeParse(body);
  if (!parsed.success) {
    throwUnmappable(
      `${formatZodErrorMessage(parsed.error)}. Use ${NEW_PATCH} with expectedRevision and projectId.`,
      NEW_PATCH,
    );
  }
  return parsed.data;
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
      occurrences: schedule.targetRunCount,
      intervalDays: schedule.intervalDays,
      anchorAt: schedule.anchorAt,
    },
  });
}

export async function resolveTaskScheduleId(
  taskId: string,
): Promise<string | null> {
  const byScheduleId = await prisma.taskSchedule.findFirst({
    where: { id: taskId },
    select: { id: true },
  });
  if (byScheduleId) {
    return byScheduleId.id;
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { scheduleId: true },
  });
  if (task?.scheduleId) {
    return task.scheduleId;
  }

  const migratedId = migratedTaskScheduleId(taskId);
  const migrated = await prisma.taskSchedule.findFirst({
    where: { id: migratedId },
    select: { id: true },
  });
  if (migrated) {
    return migrated.id;
  }

  const shimId = shimCreatedTaskScheduleId(taskId);
  const shimmed = await prisma.taskSchedule.findFirst({
    where: { id: shimId },
    select: { id: true },
  });
  return shimmed?.id ?? null;
}

export async function requireResolvedTaskScheduleId(
  taskId: string,
): Promise<string> {
  const scheduleId = await resolveTaskScheduleId(taskId);
  if (!scheduleId) {
    throw notFound(
      "No Task Schedule is linked to this Task. The template id may have been deleted in the cutover. Use GET /v1/tasks/schedules/{id} with the schedule id.",
    );
  }
  return scheduleId;
}

export async function findTaskBlueprint(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      description: true,
      projectId: true,
      visibility: true,
      assigneeId: true,
      assigneeSokoBotId: true,
      scheduleId: true,
    },
  });
}

export function mapTaskBlueprintToCreate(
  task: NonNullable<Awaited<ReturnType<typeof findTaskBlueprint>>>,
  schedule: LegacyTaskScheduleInput,
): CreateTaskScheduleRequest {
  rejectOnceOrPersonAssignee(schedule, undefined, NEW_CREATE);
  if (!task.name?.trim()) {
    throwUnmappable(
      `The Task has no name. Use ${NEW_CREATE} with name and a typed rule.`,
      NEW_CREATE,
    );
  }
  return parseMappedCreate({
    name: task.name,
    description: task.description,
    projectId: task.projectId,
    visibility: task.visibility,
    assigneeId: task.assigneeId,
    assigneeSokoBotId: task.assigneeSokoBotId,
    rule: mapRecurringRule(schedule),
  });
}

export { shimCreatedTaskScheduleId };
