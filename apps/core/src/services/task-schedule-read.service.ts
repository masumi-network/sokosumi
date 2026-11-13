// Task Schedule read access, projections and response mapping share one authority calculation.
import {
  type Prisma,
  type TaskSchedule,
  type TaskScheduleRun,
  TaskScheduleState,
  TaskVisibility,
  VendorGrantStatus,
  workCreatorInclude,
} from "@sokosumi/database";
import {
  requireCoworkerCapability,
  requireGrantedWorkspaceAccessOrRequest,
} from "@/helpers/access-control";
import { forbidden, notFound } from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import {
  buildCoworkerPrivateTaskVisibilityWhere,
  buildHumanTaskVisibilityWhere,
  isPrivateTaskVisibleToCoworker,
} from "@/helpers/task-visibility";
import { getWorkspaceGrant } from "@/helpers/vendor-grants";
import { mapWorkCreator } from "@/helpers/work-creator";
import prisma from "@/lib/db/prisma";
import type { EnvVariables } from "@/lib/hono";
import {
  hasReadableSeoMonitorPlan,
  isSeoMonitorDescription,
  seoMonitorDescriptionForUser,
  seoMonitorSummary,
} from "@/lib/seo/monitor-plan";
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
  TaskScheduleListQuery,
  TaskScheduleRunListQuery,
} from "@/schemas/task-schedule.schema";

/**
 * Who reads or changes a schedule: a person, or a Coworker with a GRANTED
 * workspace grant acting for the member `userId`.
 */
export type TaskScheduleReader =
  | { kind: "user"; userId: string }
  | { kind: "coworker"; coworkerId: string; vendorId: string; userId: string };

export type ScheduleActor = TaskScheduleReader & {
  workspace: WorkspaceContext;
};

export type RouteVars = EnvVariables["Variables"];

export async function resolveScheduleActor(
  vars: RouteVars,
  { requestMissingGrant = true }: { requestMissingGrant?: boolean } = {},
): Promise<ScheduleActor> {
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
    const grant = await getWorkspaceGrant({
      vendorId: authContext.vendorId,
      workspaceId: workspace.workspaceId,
    });
    if (requestMissingGrant) {
      await requireGrantedWorkspaceAccessOrRequest({
        vendorId: authContext.vendorId,
        workspaceId: workspace.workspaceId,
        requestedByUserId: userContext.userId,
        grant,
      });
    } else if (grant?.status !== VendorGrantStatus.GRANTED) {
      throw forbidden("This Coworker has no workspace grant here");
    }
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

/**
 * What `canWriteTaskSchedule` reads beyond the schedule's own columns, and the
 * Creator a response maps.
 */
export const SCHEDULE_ASSIGNEE_VENDOR = {
  assignee: { select: { vendorId: true } },
  ...workCreatorInclude,
} as const;

export type ScheduleWithAssigneeVendor = Prisma.TaskScheduleGetPayload<{
  include: typeof SCHEDULE_ASSIGNEE_VENDOR;
}>;

/** A schedule as its reader gets it: with whether they may change it. */
export type TaskScheduleView = Omit<ScheduleWithAssigneeVendor, "assignee"> & {
  canWrite: boolean;
};

export function toTaskScheduleView(
  reader: TaskScheduleReader,
  { assignee, ...schedule }: ScheduleWithAssigneeVendor,
): TaskScheduleView {
  return {
    ...schedule,
    canWrite: canWriteTaskSchedule(reader, { ...schedule, assignee }),
  };
}

export async function findReadableSchedule(
  actor: ScheduleActor,
  id: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const schedule = await tx.taskSchedule.findFirst({
    where: { id, ...readableWhere(actor) },
    include: SCHEDULE_ASSIGNEE_VENDOR,
  });
  if (!schedule) {
    throw notFound("Task Schedule not found");
  }
  return schedule;
}

export async function getTaskSchedule(
  vars: RouteVars,
  id: string,
): Promise<TaskScheduleView> {
  const actor = await resolveScheduleActor(vars);
  return toTaskScheduleView(actor, await findReadableSchedule(actor, id));
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
      include: SCHEDULE_ASSIGNEE_VENDOR,
      take: take + 1,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.taskSchedule.count({ where }),
  ]);
  const hasMore = rows.length > take;
  const schedules = rows
    .slice(0, take)
    .map((row) => toTaskScheduleView(actor, row));
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
  const where: Prisma.TaskScheduleRunWhereInput = {
    scheduleId: id,
    effectiveScheduledAt: {
      gte: query.from ? new Date(query.from) : undefined,
      lt: query.to ? new Date(query.to) : undefined,
    },
    manual: query.manual === undefined ? undefined : query.manual === "true",
  };
  const [rows, total] = await Promise.all([
    prisma.taskScheduleRun.findMany({
      where,
      take: take + 1,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
    }),
    prisma.taskScheduleRun.count({ where }),
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
  "ownerId" | "visibility" | "creatorCoworkerId" | "assigneeId"
> & {
  assignee: { vendorId: string } | null;
};

/**
 * Members change the public schedules of their workspace and their own
 * private ones, as they do Tasks (ADR 0048). A Coworker changes those of the
 * member it acts for that it created or whose assignee is in its vendor
 * family. The schedule must be one read in the writer's workspace.
 */
export function canWriteTaskSchedule(
  writer: TaskScheduleReader,
  schedule: WritableScheduleFields,
): boolean {
  if (
    schedule.visibility !== TaskVisibility.PUBLIC &&
    schedule.ownerId !== writer.userId
  ) {
    return false;
  }
  if (
    writer.kind === "coworker" &&
    !isPrivateTaskVisibleToCoworker(schedule, writer)
  ) {
    return false;
  }
  return (
    writer.kind === "user" ||
    schedule.creatorCoworkerId === writer.coworkerId ||
    schedule.assigneeId === writer.coworkerId ||
    schedule.assignee?.vendorId === writer.vendorId
  );
}

export function requireScheduleWriteAccess(
  actor: ScheduleActor,
  schedule: WritableScheduleFields,
): void {
  if (canWriteTaskSchedule(actor, schedule)) {
    return;
  }
  throw forbidden(
    actor.kind === "user"
      ? "Only the owner can change a private Task Schedule"
      : "Coworkers can only change the Task Schedules they created or whose assignee is in their vendor family",
  );
}

/**
 * An SEO monitor bills its Runs to its owner within a count the owner approved. Only that owner may add a Run or
 * change the rule: other members and the assigned Coworker keep pause, resume and end.
 */
export function requireSeoMonitorOwner(
  actor: ScheduleActor,
  schedule: { description: string | null; ownerId: string | null },
): void {
  if (!isSeoMonitorDescription(schedule.description)) return;
  if (actor.kind === "user" && actor.userId === schedule.ownerId) return;
  throw forbidden("Only the owner can run or change an SEO monitor's rule");
}

export function mapTaskSchedule(schedule: TaskScheduleView) {
  return {
    id: schedule.id,
    workspaceId: schedule.workspaceId,
    organizationId: schedule.organizationId,
    ownerId: schedule.ownerId,
    creatorUserId: schedule.creatorUserId,
    creatorCoworkerId: schedule.creatorCoworkerId,
    creatorSokoBotId: schedule.creatorSokoBotId,
    creator: mapWorkCreator(`TaskSchedule ${schedule.id}`, schedule),
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
    description: seoMonitorDescriptionForUser(schedule.description),
    projectId: schedule.projectId,
    visibility: schedule.visibility,
    assigneeId: schedule.assigneeId,
    assigneeSokoBotId: schedule.assigneeSokoBotId,
    assigneeUserId: schedule.assigneeUserId,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    canWrite: schedule.canWrite,
    canRunNow:
      schedule.canWrite &&
      schedule.state !== TaskScheduleState.ENDED &&
      hasReadableSeoMonitorPlan(schedule.description),
    // An SEO monitor is edited in the SEO workspace: this editor would send its blueprint too.
    canEditPlan:
      schedule.canWrite &&
      schedule.state !== TaskScheduleState.ENDED &&
      !isSeoMonitorDescription(schedule.description),
    seoMonitor: seoMonitorSummary(schedule.description),
  };
}

export function mapTaskScheduleRun(run: TaskScheduleRun) {
  return {
    id: run.id,
    state: run.state,
    originalScheduledAt: run.originalScheduledAt,
    effectiveScheduledAt: run.effectiveScheduledAt,
    manual: run.manual,
    releasedTaskId: run.releasedTaskId,
    actorUserId: run.actorUserId,
    actorCoworkerId: run.actorCoworkerId,
    updatedAt: run.updatedAt,
  };
}
