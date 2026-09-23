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
  TaskScheduleOccurrenceListQuery,
  TaskScheduleRule,
  UpdateScheduleOccurrenceRequest,
  UpdateTaskScheduleRequest,
} from "@/schemas/task-schedule.schema";
import {
  creatorFields,
  requireNoHumanAssigneeOnPrivateTask,
  requireTaskReferences,
  type TaskDomainActor,
} from "@/services/task-domain.service";
import {
  moveTaskScheduleOccurrencesToProject,
  projectTaskScheduleOccurrences,
  removePlannedTaskScheduleOccurrences,
  retireUpcomingTaskScheduleOccurrences,
  trimPlannedTaskScheduleOccurrences,
} from "@/services/task-schedule-occurrences.service";

/**
 * Task Schedule operations (ADR 0040). Owns who may see and change a
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

type ScheduleActor =
  | { kind: "user"; userId: string; workspace: WorkspaceContext }
  | {
      kind: "coworker";
      coworkerId: string;
      vendorId: string;
      userId: string;
      workspace: WorkspaceContext;
    };

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
 * first Occurrence.
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
    occurrences: rule.targetOccurrenceCount ?? undefined,
    intervalDays: rule.intervalDays ?? undefined,
    anchorAt: rule.anchorAt ?? undefined,
  });
}

/** Every new rule starts a new epoch of Occurrences. */
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
    targetOccurrenceCount: rule.targetOccurrenceCount ?? null,
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
        nextOccurrenceAt: await projectTaskScheduleOccurrences(
          tx,
          schedule,
          now,
        ),
      },
    });
  });
}

function readableWhere(actor: ScheduleActor): Prisma.TaskScheduleWhereInput {
  if (actor.kind === "user") {
    return {
      workspaceId: actor.workspace.workspaceId,
      ...buildHumanTaskVisibilityWhere(actor.userId),
    };
  }
  // A private schedule stays with its owner: a Coworker sees one only while
  // acting for that owner, and then only on its vendor family, as for Tasks.
  return {
    workspaceId: actor.workspace.workspaceId,
    AND: [
      buildHumanTaskVisibilityWhere(actor.userId),
      buildCoworkerPrivateTaskVisibilityWhere(actor),
    ],
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

export async function listTaskScheduleOccurrences(
  vars: RouteVars,
  id: string,
  query: TaskScheduleOccurrenceListQuery,
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
  const occurrences = rows.slice(0, take);
  return {
    occurrences,
    pagination: createPaginationMeta(occurrences, total, take, hasMore, cursor),
  };
}

/**
 * People change only the schedules they own, as they do Tasks. A Coworker
 * changes the acting member's schedules it created or whose assignee is in
 * its vendor family.
 */
function requireScheduleWriteAccess(
  actor: ScheduleActor,
  schedule: Pick<
    TaskSchedule,
    "ownerId" | "creatorCoworkerId" | "assigneeId"
  > & {
    assignee: { vendorId: string } | null;
  },
): void {
  if (actor.kind === "user") {
    if (schedule.ownerId !== actor.userId) {
      throw forbidden("Only the owner can change this Task Schedule");
    }
    return;
  }
  const isVendorFamily =
    schedule.creatorCoworkerId === actor.coworkerId ||
    schedule.assigneeId === actor.coworkerId ||
    schedule.assignee?.vendorId === actor.vendorId;
  if (schedule.ownerId !== actor.userId || !isVendorFamily) {
    throw forbidden(
      "Coworkers can only change the acting member's Task Schedules they created or whose assignee is in their vendor family",
    );
  }
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
 * Revision-checked edit. Changes future Occurrences only: Tasks already
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
      rule?.targetOccurrenceCount != null &&
      rule.targetOccurrenceCount <= current.releasedCount
    ) {
      throw unprocessableEntity(
        "targetOccurrenceCount must be greater than the Occurrences already released",
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

    // The old rule's future Occurrences go; ones already owed still release,
    // and released ones and their Tasks stay. A Paused schedule plans again
    // on resume.
    let schedule = updated;
    if (input.rule) {
      await retireUpcomingTaskScheduleOccurrences(tx, id, now);
      if (updated.state === TaskScheduleState.ACTIVE) {
        schedule = await tx.taskSchedule.update({
          where: { id },
          data: {
            nextOccurrenceAt: await projectTaskScheduleOccurrences(
              tx,
              updated,
              now,
            ),
          },
        });
      }
    }
    // Owed rows survive a rule edit, so a project change in the same request
    // still has to move them. New rows already use the updated project.
    if (input.projectId !== undefined) {
      await moveTaskScheduleOccurrencesToProject(tx, schedule);
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
 * Pause stops Occurrences without losing the schedule; resume picks up at the
 * first Occurrence after now (missed ones are not made up), or Ends the
 * schedule when its end rule passed meanwhile; end is final. Pause and end
 * drop the planned Occurrences; resume plans them again.
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

    const nextOccurrenceAt =
      to === TaskScheduleState.ACTIVE
        ? await projectTaskScheduleOccurrences(tx, current, new Date())
        : null;
    // Resuming past the end rule ends the schedule instead.
    const state =
      to === TaskScheduleState.ACTIVE && !nextOccurrenceAt
        ? TaskScheduleState.ENDED
        : to;
    if (!nextOccurrenceAt) {
      await removePlannedTaskScheduleOccurrences(tx, id);
    }

    const { count } = await tx.taskSchedule.updateMany({
      where: { id, state: current.state },
      data: { state, nextOccurrenceAt, revision: { increment: 1 } },
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

const OCCURRENCE_ACTION_LABELS: Record<
  UpdateScheduleOccurrenceRequest["action"],
  string
> = { skip: "skipped", move: "moved", restore: "restored" };

/**
 * The row an action leaves behind. Only an upcoming Occurrence that has not
 * created its Task changes: a planned one can be skipped or moved, and a
 * skipped or moved one restored. A skip keeps the Occurrence's time, a move
 * keeps the rule's time in `originalScheduledAt`, and a restore puts the
 * Occurrence back at the rule's time. The time it ends up at must be in the
 * future and inside the projection horizon.
 */
function occurrenceChange(
  occurrence: TaskScheduleOccurrence,
  input: UpdateScheduleOccurrenceRequest,
  now: Date,
): { state: TaskScheduleOccurrenceState; effectiveScheduledAt: Date } {
  const isMoved =
    occurrence.originalScheduledAt?.getTime() !==
    occurrence.effectiveScheduledAt.getTime();
  const changeable =
    input.action === "restore"
      ? occurrence.state === TaskScheduleOccurrenceState.SKIPPED ||
        (occurrence.state === TaskScheduleOccurrenceState.PLANNED && isMoved)
      : occurrence.state === TaskScheduleOccurrenceState.PLANNED;
  if (
    !changeable ||
    occurrence.releasedTaskId !== null ||
    occurrence.effectiveScheduledAt <= now
  ) {
    throw conflict(
      `This Occurrence cannot be ${OCCURRENCE_ACTION_LABELS[input.action]} from its current state`,
      { kind: CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_STATE_CONFLICT },
    );
  }

  const target =
    input.action === "skip"
      ? occurrence.effectiveScheduledAt
      : input.action === "move"
        ? new Date(input.scheduledAt)
        : occurrence.originalScheduledAt;
  if (
    !target ||
    target <= now ||
    target.getTime() >= now.getTime() + CALENDAR_OCCURRENCE_HORIZON_MS
  ) {
    throw unprocessableEntity(
      "The Occurrence's time must be in the future and inside the projection horizon",
      { kind: CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_TARGET_INVALID },
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
 * Skip, move, or restore one upcoming Occurrence (ADR 0040). The exception is
 * recorded on the Occurrence row, with who made it; the rule stays as it is.
 */
export async function changeTaskScheduleOccurrence(
  vars: RouteVars,
  id: string,
  occurrenceId: string,
  input: UpdateScheduleOccurrenceRequest,
): Promise<{ revision: number; occurrence: TaskScheduleOccurrence }> {
  const actor = await resolveScheduleActor(vars);

  return await prisma.$transaction(async (tx) => {
    const current = await findReadableSchedule(actor, id, tx);
    requireScheduleWriteAccess(actor, current);
    if (current.state !== TaskScheduleState.ACTIVE) {
      throwStateConflict(
        "Only the Occurrences of an Active Task Schedule can be changed",
      );
    }
    if (current.revision !== input.expectedRevision) {
      throwRevisionConflict();
    }
    const occurrence = await tx.taskScheduleOccurrence.findFirst({
      where: { id: occurrenceId, scheduleId: id },
    });
    if (!occurrence) {
      throw notFound("Occurrence not found");
    }

    const now = new Date();
    const change = occurrenceChange(occurrence, input, now);
    const { count } = await tx.taskScheduleOccurrence.updateMany({
      where: {
        id: occurrenceId,
        state: occurrence.state,
        releasedTaskId: null,
      },
      data: { ...change, ...actorColumns(actor) },
    });
    if (count !== 1) {
      throwRevisionConflict();
    }

    await trimPlannedTaskScheduleOccurrences(tx, current, occurrenceId);
    // With its last Occurrence skipped, the schedule still wakes then, so the
    // release Ends it on time and the skip can be restored until then.
    const nextOccurrenceAt =
      (await projectTaskScheduleOccurrences(tx, current, now)) ??
      change.effectiveScheduledAt;
    const { count: claimed } = await tx.taskSchedule.updateMany({
      where: { id, revision: input.expectedRevision },
      data: { nextOccurrenceAt, revision: { increment: 1 } },
    });
    if (claimed !== 1) {
      throwRevisionConflict();
    }
    return {
      revision: input.expectedRevision + 1,
      occurrence: await tx.taskScheduleOccurrence.findUniqueOrThrow({
        where: { id: occurrenceId },
      }),
    };
  });
}

/**
 * Tasks the schedule created stay; the database sets their `scheduleId` to
 * null (ADR 0040).
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
      targetOccurrenceCount: schedule.targetOccurrenceCount,
    },
    ruleEffectiveFrom: schedule.ruleEffectiveFrom,
    releasedCount: schedule.releasedCount,
    nextOccurrenceAt: schedule.nextOccurrenceAt,
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

export function mapScheduleOccurrence(occurrence: TaskScheduleOccurrence) {
  return {
    id: occurrence.id,
    state: occurrence.state,
    originalScheduledAt: occurrence.originalScheduledAt,
    effectiveScheduledAt: occurrence.effectiveScheduledAt,
    releasedTaskId: occurrence.releasedTaskId,
    actorUserId: occurrence.actorUserId,
    actorCoworkerId: occurrence.actorCoworkerId,
    updatedAt: occurrence.updatedAt,
  };
}
