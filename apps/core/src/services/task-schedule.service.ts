import { randomUUID } from "node:crypto";

import {
  type Prisma,
  type TaskSchedule,
  TaskScheduleEndsMode,
  type TaskScheduleOccurrence,
  TaskScheduleOccurrenceState,
  TaskScheduleState,
  TaskVisibility,
} from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import {
  requireCoworkerCapability,
  requireGrantedWorkspaceAccessOrRequest,
} from "@/helpers/access-control";
import {
  lockCalendarScope,
  requireOpenCalendarProject,
} from "@/helpers/calendar-locks";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { nextAssigneeWrite } from "@/helpers/task-assignee-alias";
import { validateScheduleInput } from "@/helpers/task-schedule";
import { CALENDAR_OCCURRENCE_HORIZON_MS } from "@/helpers/task-schedule-occurrence-index";
import {
  buildCoworkerPrivateTaskVisibilityWhere,
  buildHumanTaskVisibilityWhere,
} from "@/helpers/task-visibility";
import { getWorkspaceGrant } from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import {
  isCoworkerAuthContext,
  isSokoBotAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import {
  requireWorkspaceContext,
  type WorkspaceContext,
} from "@/middleware/workspace";
import type {
  CreateTaskScheduleRequest,
  TaskScheduleListQuery,
  TaskScheduleRule,
  TaskScheduleRunListQuery,
  UpdateTaskScheduleRequest,
  UpdateTaskScheduleRunRequest,
} from "@/schemas/task-schedule.schema";
import {
  creatorFields,
  requireNoHumanAssigneeOnPrivateTask,
  requireTaskReferences,
  type TaskDomainActor,
} from "@/services/task-domain.service";
import {
  cancelMissedTaskScheduleRuns,
  isRunException,
  moveTaskScheduleRunsToProject,
  projectTaskScheduleRuns,
  stopPlannedTaskScheduleRuns,
  trimPlannedTaskScheduleRuns,
} from "@/services/task-schedule-runs.service";

/**
 * Task Schedule operations (ADR 0041). Owns who may see and change a
 * schedule, and which state moves are legal; routes only parse and respond.
 *
 * Access: every caller passes the organization Seat gate for the member it
 * acts as. People read workspace schedules through the Task visibility rule
 * and change only the ones they own. Coworkers also need the tasks
 * capability and a GRANTED vendor workspace grant; they act only on public
 * schedules and on the private ones of the member they act for, and change
 * that member's schedules they created or whose assignee is in their vendor
 * family.
 */

/**
 * Who reads or changes a schedule: a person, or a Coworker with a GRANTED
 * workspace grant acting for the member `userId`.
 */
export type TaskScheduleReader =
  | { kind: "user"; userId: string }
  | { kind: "coworker"; coworkerId: string; vendorId: string; userId: string };

type ScheduleActor = TaskScheduleReader & { workspace: WorkspaceContext };

type RouteVars = EnvVariables["Variables"];

async function resolveScheduleActor(vars: RouteVars): Promise<ScheduleActor> {
  const { authContext } = vars;
  if (isSokoBotAuthContext(authContext)) {
    throw forbidden("Soko Bots cannot manage Task Schedules");
  }
  const userContext = requireUserContext(authContext);
  const workspace = requireWorkspaceContext(vars.workspaceContext);
  await requireAssignedOrganizationSeat(
    userContext.userId,
    workspace.organizationId,
  );

  if (isCoworkerAuthContext(authContext)) {
    await requireCoworkerCapability(authContext.coworkerId, "tasks");
    await requireGrantedWorkspaceAccessOrRequest({
      vendorId: authContext.vendorId,
      workspaceId: workspace.workspaceId,
      requestedByUserId: userContext.userId,
      grant: await getWorkspaceGrant({
        vendorId: authContext.vendorId,
        workspaceId: workspace.workspaceId,
      }),
    });
    return {
      kind: "coworker",
      coworkerId: authContext.coworkerId,
      vendorId: authContext.vendorId,
      userId: userContext.userId,
      workspace,
    };
  }

  return { kind: "user", userId: userContext.userId, workspace };
}

function toDomainActor(actor: ScheduleActor): TaskDomainActor {
  return actor.kind === "user"
    ? { kind: "user", userId: actor.userId }
    : {
        kind: "coworker",
        coworkerId: actor.coworkerId,
        vendorId: actor.vendorId,
        enforceWorkspaceGrant: true,
      };
}

/**
 * The rule is checked with the same validation as the per-Task schedule it
 * replaces: timezone, cron or interval anchor, and an end date after the
 * first Run.
 */
function validateRule(rule: TaskScheduleRule): void {
  validateScheduleInput({
    mode: "recurring",
    expr: rule.expr,
    timezone: rule.timezone,
    endsMode:
      rule.endsMode === TaskScheduleEndsMode.ON
        ? "on"
        : rule.endsMode === TaskScheduleEndsMode.AFTER
          ? "after"
          : "never",
    endsOn: rule.endsOn ?? undefined,
    occurrences: rule.targetRunCount ?? undefined,
    intervalDays: rule.intervalDays ?? undefined,
    anchorAt: rule.anchorAt ?? undefined,
  });
}

/** Every new rule starts a new epoch of Runs. */
function ruleColumns(rule: TaskScheduleRule, now: Date) {
  return {
    expr: rule.expr,
    timezone: rule.timezone,
    intervalDays: rule.intervalDays ?? null,
    anchorAt: rule.anchorAt ? new Date(rule.anchorAt) : now,
    ruleEffectiveFrom: now,
    epochId: randomUUID(),
    endsMode: rule.endsMode,
    endsOn: rule.endsOn ? new Date(rule.endsOn) : null,
    targetRunCount: rule.targetRunCount ?? null,
  };
}

function resolveVisibility(
  requested: CreateTaskScheduleRequest["visibility"],
  workspace: WorkspaceContext,
): TaskVisibility {
  if (requested !== TaskVisibility.PRIVATE) return TaskVisibility.PUBLIC;
  if (workspace.organizationId == null) {
    throw badRequest(
      "Private Task Schedules are only allowed in organization workspaces",
    );
  }
  return TaskVisibility.PRIVATE;
}

/**
 * A closing project Ends its schedules and a closed one never releases, so a
 * schedule neither joins nor changes in one. The scope is locked first, as the
 * close request locks it, so a close cannot slip in between.
 */
async function requireOpenScheduleProjects(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [
    ...new Set(projectIds.filter((id): id is string => Boolean(id))),
  ];
  if (ids.length === 0) return;
  if (!(await lockCalendarScope(tx, workspaceId, ids))) {
    throw notFound("Project not found");
  }
  for (const id of ids) {
    await requireOpenCalendarProject(tx, workspaceId, id);
  }
}

export async function createTaskSchedule(
  vars: RouteVars,
  input: CreateTaskScheduleRequest,
): Promise<TaskSchedule> {
  const actor = await resolveScheduleActor(vars);
  validateRule(input.rule);
  const visibility = resolveVisibility(input.visibility, actor.workspace);
  requireNoHumanAssigneeOnPrivateTask(visibility, input.assigneeUserId);

  const now = new Date();
  const rule = ruleColumns(input.rule, now);
  const domainActor = toDomainActor(actor);
  const blueprint = {
    projectId: input.projectId ?? null,
    assigneeId: input.assigneeId ?? null,
    assigneeSokoBotId: input.assigneeSokoBotId ?? null,
    assigneeUserId: input.assigneeUserId ?? null,
  };

  return await prisma.$transaction(async (tx) => {
    await requireTaskReferences(
      {
        ...blueprint,
        workspaceId: actor.workspace.workspaceId,
        actor: domainActor,
      },
      tx,
    );
    await requireOpenScheduleProjects(tx, actor.workspace.workspaceId, [
      blueprint.projectId,
    ]);
    const schedule = await tx.taskSchedule.create({
      data: {
        workspaceId: actor.workspace.workspaceId,
        organizationId: actor.workspace.organizationId,
        ownerId: actor.userId,
        ...creatorFields(domainActor),
        ...rule,
        name: input.name,
        description: input.description ?? null,
        visibility,
        ...blueprint,
      },
    });
    return await tx.taskSchedule.update({
      where: { id: schedule.id },
      data: {
        nextRunAt: await projectTaskScheduleRuns(tx, schedule, now),
      },
    });
  });
}

/** The schedules a reader sees, in any workspace it may read. */
export function taskScheduleVisibilityWhere(
  reader: TaskScheduleReader,
): Prisma.TaskScheduleWhereInput {
  if (reader.kind === "user") {
    return buildHumanTaskVisibilityWhere(reader.userId);
  }
  // A private schedule stays with its owner: a Coworker sees one only while
  // acting for that owner, and then only on its vendor family, as for Tasks.
  return {
    AND: [
      buildHumanTaskVisibilityWhere(reader.userId),
      buildCoworkerPrivateTaskVisibilityWhere(reader),
    ],
  };
}

function readableWhere(actor: ScheduleActor): Prisma.TaskScheduleWhereInput {
  return {
    workspaceId: actor.workspace.workspaceId,
    ...taskScheduleVisibilityWhere(actor),
  };
}

async function findReadableSchedule(
  actor: ScheduleActor,
  id: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const schedule = await tx.taskSchedule.findFirst({
    where: { id, ...readableWhere(actor) },
    include: { assignee: { select: { vendorId: true } } },
  });
  if (!schedule) {
    throw notFound("Task Schedule not found");
  }
  return schedule;
}

export async function getTaskSchedule(
  vars: RouteVars,
  id: string,
): Promise<TaskSchedule> {
  const actor = await resolveScheduleActor(vars);
  const { assignee: _assignee, ...schedule } = await findReadableSchedule(
    actor,
    id,
  );
  return schedule;
}

export async function listTaskSchedules(
  vars: RouteVars,
  query: TaskScheduleListQuery,
) {
  const actor = await resolveScheduleActor(vars);
  const { cursor, take, skip } = parseCursorPagination(query);
  const where: Prisma.TaskScheduleWhereInput = {
    ...readableWhere(actor),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.state ? { state: query.state } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.taskSchedule.findMany({
      where,
      take: take + 1,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.taskSchedule.count({ where }),
  ]);
  const hasMore = rows.length > take;
  const schedules = rows.slice(0, take);
  return {
    schedules,
    pagination: createPaginationMeta(schedules, total, take, hasMore, cursor),
  };
}

export async function listTaskScheduleRuns(
  vars: RouteVars,
  id: string,
  query: TaskScheduleRunListQuery,
) {
  const actor = await resolveScheduleActor(vars);
  await findReadableSchedule(actor, id);
  const { cursor, take, skip } = parseCursorPagination(query);
  const where: Prisma.TaskScheduleOccurrenceWhereInput = {
    scheduleId: id,
    effectiveScheduledAt: {
      gte: query.from ? new Date(query.from) : undefined,
      lt: query.to ? new Date(query.to) : undefined,
    },
  };
  const [rows, total] = await Promise.all([
    prisma.taskScheduleOccurrence.findMany({
      where,
      take: take + 1,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    }),
    prisma.taskScheduleOccurrence.count({ where }),
  ]);
  const hasMore = rows.length > take;
  const runs = rows.slice(0, take);
  return {
    runs,
    pagination: createPaginationMeta(runs, total, take, hasMore, cursor),
  };
}

type WritableScheduleFields = Pick<
  TaskSchedule,
  "ownerId" | "creatorCoworkerId" | "assigneeId"
> & {
  assignee: { vendorId: string } | null;
};

/**
 * People change only the schedules they own, as they do Tasks. A Coworker
 * changes the acting member's schedules it created or whose assignee is in
 * its vendor family.
 */
export function canWriteTaskSchedule(
  writer: TaskScheduleReader,
  schedule: WritableScheduleFields,
): boolean {
  if (schedule.ownerId !== writer.userId) {
    return false;
  }
  return (
    writer.kind === "user" ||
    schedule.creatorCoworkerId === writer.coworkerId ||
    schedule.assigneeId === writer.coworkerId ||
    schedule.assignee?.vendorId === writer.vendorId
  );
}

function requireScheduleWriteAccess(
  actor: ScheduleActor,
  schedule: WritableScheduleFields,
): void {
  if (canWriteTaskSchedule(actor, schedule)) {
    return;
  }
  throw forbidden(
    actor.kind === "user"
      ? "Only the owner can change this Task Schedule"
      : "Coworkers can only change the acting member's Task Schedules they created or whose assignee is in their vendor family",
  );
}

function throwStateConflict(message: string): never {
  throw conflict(message, {
    kind: CORE_API_ERROR_KINDS.SCHEDULE_STATE_CONFLICT,
  });
}

function throwRevisionConflict(): never {
  throw conflict("Task Schedule changed since it was read", {
    kind: CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT,
  });
}

/**
 * Revision-checked edit. Changes future Runs only: Tasks already
 * created keep their values, and a new rule counts from now.
 */
export async function updateTaskSchedule(
  vars: RouteVars,
  id: string,
  input: UpdateTaskScheduleRequest,
): Promise<TaskSchedule> {
  const actor = await resolveScheduleActor(vars);
  if (input.rule) validateRule(input.rule);

  return await prisma.$transaction(async (tx) => {
    const current = await findReadableSchedule(actor, id, tx);
    requireScheduleWriteAccess(actor, current);
    if (current.state === TaskScheduleState.ENDED) {
      throwStateConflict("An Ended Task Schedule cannot be changed");
    }

    const now = new Date();
    const rule = input.rule ? ruleColumns(input.rule, now) : undefined;
    if (
      rule?.targetRunCount != null &&
      rule.targetRunCount <= current.releasedCount
    ) {
      throw unprocessableEntity(
        "targetRunCount must be greater than the Runs already released",
      );
    }

    const assignees = nextAssigneeWrite(input);
    requireNoHumanAssigneeOnPrivateTask(
      current.visibility,
      assignees?.assigneeUserId,
    );
    await requireTaskReferences(
      {
        projectId: input.projectId,
        ...assignees,
        workspaceId: current.workspaceId,
        actor: toDomainActor(actor),
      },
      tx,
    );
    await requireOpenScheduleProjects(tx, current.workspaceId, [
      current.projectId,
      input.projectId,
    ]);

    const { count } = await tx.taskSchedule.updateMany({
      where: { id, revision: input.expectedRevision },
      data: {
        name: input.name,
        description: input.description,
        projectId: input.projectId,
        ...assignees,
        ...rule,
        revision: { increment: 1 },
      },
    });
    if (count === 0) {
      throwRevisionConflict();
    }
    const updated = await tx.taskSchedule.findUniqueOrThrow({ where: { id } });

    // The old rule's future Runs go, its skips and moves into the
    // history; ones already owed still release, and released ones and their
    // Tasks stay. A Paused schedule plans again on resume.
    let schedule = updated;
    if (input.rule) {
      await stopPlannedTaskScheduleRuns(tx, id, now, {
        keepOwed: true,
        exceptions: "cancel",
      });
      if (updated.state === TaskScheduleState.ACTIVE) {
        schedule = await tx.taskSchedule.update({
          where: { id },
          data: {
            nextRunAt: await projectTaskScheduleRuns(tx, updated, now),
          },
        });
      }
    }
    // Owed rows survive a rule edit, so a project change in the same request
    // still has to move them. New rows already use the updated project.
    if (input.projectId !== undefined) {
      await moveTaskScheduleRunsToProject(tx, schedule);
    }
    return schedule;
  });
}

export type TaskScheduleStateAction = "pause" | "resume" | "end";

const STATE_ACTIONS: Record<
  TaskScheduleStateAction,
  {
    from: readonly TaskScheduleState[];
    to: TaskScheduleState;
    label: string;
  }
> = {
  pause: {
    from: [TaskScheduleState.ACTIVE],
    to: TaskScheduleState.PAUSED,
    label: "paused",
  },
  resume: {
    from: [TaskScheduleState.PAUSED],
    to: TaskScheduleState.ACTIVE,
    label: "resumed",
  },
  end: {
    from: [TaskScheduleState.ACTIVE, TaskScheduleState.PAUSED],
    to: TaskScheduleState.ENDED,
    label: "ended",
  },
};

/**
 * Pause stops Runs without losing the schedule; resume picks up at the
 * first Run after now (missed ones are not made up), or Ends the
 * schedule when its end rule passed meanwhile; end is final. Pause drops the
 * planned Runs but keeps skips and moves; resume plans again. End
 * cancels skips and moves into the history.
 */
export async function changeTaskScheduleState(
  vars: RouteVars,
  id: string,
  action: TaskScheduleStateAction,
): Promise<TaskSchedule> {
  const actor = await resolveScheduleActor(vars);

  return await prisma.$transaction(async (tx) => {
    const current = await findReadableSchedule(actor, id, tx);
    requireScheduleWriteAccess(actor, current);
    const { from, to, label } = STATE_ACTIONS[action];
    if (!from.includes(current.state)) {
      throwStateConflict(
        `A Task Schedule that is ${current.state} cannot be ${label}`,
      );
    }

    const now = new Date();
    if (to === TaskScheduleState.ACTIVE) {
      await cancelMissedTaskScheduleRuns(tx, id, now);
    }
    const nextRunAt =
      to === TaskScheduleState.ACTIVE
        ? await projectTaskScheduleRuns(tx, current, now)
        : null;
    // Resuming past the end rule ends the schedule instead.
    const state =
      to === TaskScheduleState.ACTIVE && !nextRunAt
        ? TaskScheduleState.ENDED
        : to;
    if (state !== TaskScheduleState.ACTIVE) {
      await stopPlannedTaskScheduleRuns(tx, id, now, {
        keepOwed: false,
        exceptions: state === TaskScheduleState.PAUSED ? "keep" : "cancel",
      });
    }

    const { count } = await tx.taskSchedule.updateMany({
      where: { id, state: current.state },
      data: { state, nextRunAt, revision: { increment: 1 } },
    });
    if (count === 0) {
      throw conflict("Task Schedule changed since it was read", {
        kind: CORE_API_ERROR_KINDS.CONCURRENCY_CONFLICT,
      });
    }
    return await tx.taskSchedule.findUniqueOrThrow({ where: { id } });
  });
}

function actorColumns(actor: ScheduleActor) {
  return actor.kind === "user"
    ? { actorUserId: actor.userId, actorCoworkerId: null }
    : { actorUserId: null, actorCoworkerId: actor.coworkerId };
}

const RUN_ACTION_LABELS: Record<
  UpdateTaskScheduleRunRequest["action"],
  string
> = { skip: "skipped", move: "moved", restore: "restored" };

/**
 * The row an action leaves behind. Only an upcoming Run that has not
 * created its Task changes: a planned one can be skipped or moved, and a
 * skipped or moved one restored. A skip keeps the Run's time, a move
 * keeps the rule's time in `originalScheduledAt`, and a restore puts the
 * Run back at the rule's time. The time it ends up at must be in the
 * future and inside the projection horizon.
 */
function runAfterAction(
  run: TaskScheduleOccurrence,
  input: UpdateTaskScheduleRunRequest,
  now: Date,
): { state: TaskScheduleOccurrenceState; effectiveScheduledAt: Date } {
  const changeable =
    input.action === "restore"
      ? isRunException(run)
      : run.state === TaskScheduleOccurrenceState.PLANNED;
  if (
    !changeable ||
    run.releasedTaskId !== null ||
    run.effectiveScheduledAt <= now
  ) {
    throw conflict(
      `This Run cannot be ${RUN_ACTION_LABELS[input.action]} from its current state`,
      { kind: CORE_API_ERROR_KINDS.SCHEDULE_RUN_STATE_CONFLICT },
    );
  }

  const target =
    input.action === "skip"
      ? run.effectiveScheduledAt
      : input.action === "move"
        ? new Date(input.scheduledAt)
        : run.originalScheduledAt;
  if (
    !target ||
    target <= now ||
    target.getTime() >= now.getTime() + CALENDAR_OCCURRENCE_HORIZON_MS
  ) {
    throw unprocessableEntity(
      "The Run's time must be in the future and inside the projection horizon",
      { kind: CORE_API_ERROR_KINDS.SCHEDULE_RUN_TARGET_INVALID },
    );
  }
  return {
    state:
      input.action === "skip"
        ? TaskScheduleOccurrenceState.SKIPPED
        : TaskScheduleOccurrenceState.PLANNED,
    effectiveScheduledAt: target,
  };
}

/**
 * Skip, move, or restore one upcoming Run (ADR 0041). The exception is
 * recorded on the Run row, with who made it; the rule stays as it is.
 */
export async function changeTaskScheduleRun(
  vars: RouteVars,
  id: string,
  runId: string,
  input: UpdateTaskScheduleRunRequest,
): Promise<{ revision: number; run: TaskScheduleOccurrence }> {
  const actor = await resolveScheduleActor(vars);

  return await prisma.$transaction(async (tx) => {
    const current = await findReadableSchedule(actor, id, tx);
    requireScheduleWriteAccess(actor, current);
    if (current.state !== TaskScheduleState.ACTIVE) {
      throwStateConflict(
        "Only the Runs of an Active Task Schedule can be changed",
      );
    }
    if (current.revision !== input.expectedRevision) {
      throwRevisionConflict();
    }
    const run = await tx.taskScheduleOccurrence.findFirst({
      where: { id: runId, scheduleId: id },
    });
    if (!run) {
      throw notFound("Run not found");
    }

    const now = new Date();
    const next = runAfterAction(run, input, now);
    // Run first, then schedule: the release locks them in the same
    // order. Claiming the schedule by its release count as well makes a
    // release that committed since the read a conflict, so the plan below
    // never counts against a stale count.
    const { count } = await tx.taskScheduleOccurrence.updateMany({
      where: {
        id: runId,
        state: run.state,
        releasedTaskId: null,
      },
      data: { ...next, ...actorColumns(actor) },
    });
    if (count !== 1) {
      throw conflict("This Run changed since it was read", {
        kind: CORE_API_ERROR_KINDS.SCHEDULE_RUN_STATE_CONFLICT,
      });
    }
    const { count: claimed } = await tx.taskSchedule.updateMany({
      where: {
        id,
        state: TaskScheduleState.ACTIVE,
        revision: input.expectedRevision,
        releasedCount: current.releasedCount,
      },
      data: { revision: { increment: 1 } },
    });
    if (claimed !== 1) {
      throw conflict("Task Schedule changed since it was read", {
        kind: CORE_API_ERROR_KINDS.CONCURRENCY_CONFLICT,
      });
    }

    await trimPlannedTaskScheduleRuns(tx, current, runId);
    // With its last Run skipped, the schedule still wakes then, so the
    // release Ends it on time and the skip can be restored until then.
    await tx.taskSchedule.update({
      where: { id },
      data: {
        nextRunAt:
          (await projectTaskScheduleRuns(tx, current, now)) ??
          next.effectiveScheduledAt,
      },
    });
    return {
      revision: input.expectedRevision + 1,
      run: await tx.taskScheduleOccurrence.findUniqueOrThrow({
        where: { id: runId },
      }),
    };
  });
}

/**
 * Tasks the schedule created stay; the database sets their `scheduleId` to
 * null (ADR 0041).
 */
export async function deleteTaskSchedule(
  vars: RouteVars,
  id: string,
): Promise<void> {
  const actor = await resolveScheduleActor(vars);
  await prisma.$transaction(async (tx) => {
    requireScheduleWriteAccess(
      actor,
      await findReadableSchedule(actor, id, tx),
    );
    await tx.taskSchedule.delete({ where: { id } });
  });
}

export function mapTaskSchedule(schedule: TaskSchedule) {
  return {
    id: schedule.id,
    workspaceId: schedule.workspaceId,
    organizationId: schedule.organizationId,
    ownerId: schedule.ownerId,
    creatorUserId: schedule.creatorUserId,
    creatorCoworkerId: schedule.creatorCoworkerId,
    creatorSokoBotId: schedule.creatorSokoBotId,
    state: schedule.state,
    rule: {
      expr: schedule.expr,
      timezone: schedule.timezone,
      intervalDays: schedule.intervalDays,
      anchorAt: schedule.anchorAt,
      endsMode: schedule.endsMode,
      endsOn: schedule.endsOn,
      targetRunCount: schedule.targetRunCount,
    },
    ruleEffectiveFrom: schedule.ruleEffectiveFrom,
    releasedCount: schedule.releasedCount,
    nextRunAt: schedule.nextRunAt,
    revision: schedule.revision,
    name: schedule.name,
    description: schedule.description,
    projectId: schedule.projectId,
    visibility: schedule.visibility,
    assigneeId: schedule.assigneeId,
    assigneeSokoBotId: schedule.assigneeSokoBotId,
    assigneeUserId: schedule.assigneeUserId,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

export function mapTaskScheduleRun(run: TaskScheduleOccurrence) {
  return {
    id: run.id,
    state: run.state,
    originalScheduledAt: run.originalScheduledAt,
    effectiveScheduledAt: run.effectiveScheduledAt,
    releasedTaskId: run.releasedTaskId,
    actorUserId: run.actorUserId,
    actorCoworkerId: run.actorCoworkerId,
    updatedAt: run.updatedAt,
  };
}
