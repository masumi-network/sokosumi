import { z } from "@hono/zod-openapi";
import {
  CalendarSourceType,
  type Prisma,
  TaskScheduleOccurrenceState,
  TaskStatus,
} from "@sokosumi/database";
import { parseTaskScheduleMetadata } from "@sokosumi/utils";

import { requireCoworkerCapability } from "@/helpers/access-control";
import { getCalendarSourceId } from "@/helpers/calendar-source";
import { badRequest, notFound } from "@/helpers/error";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
import { CALENDAR_OCCURRENCE_HORIZON_MS } from "@/helpers/task-schedule-occurrence-index";
import {
  buildHumanTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
} from "@/helpers/task-visibility";
import {
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import { type AuthenticationContext } from "@/middleware/auth";
import {
  socialPostCalendarItemSchema,
  workspaceCalendarEntrySchema,
  workspaceCalendarItemSchema,
  workspaceCalendarQuerySchema,
} from "@/schemas/workspace-calendar.schema";

interface CalendarCursor {
  id: string;
  scheduledAt: string;
}

export interface WorkspaceCalendarReadQuery {
  includeSocialPosts?: boolean;
  assigneeId?: string;
  assigneeUserId?: string;
  from: Date;
  to: Date;
  cursor: CalendarCursor | null;
  requestedCursor: string | null;
  limit: number;
  scope: "owned" | "workspace";
  status?: TaskStatus;
}

export interface WorkspaceCalendarReadOptions {
  projectId?: string;
  sourceId?: string;
  taskWhere?: Prisma.TaskWhereInput;
}

export async function getCalendarTaskWhere(
  authContext: AuthenticationContext,
  workspaceId: string,
): Promise<Prisma.TaskWhereInput | undefined> {
  if (authContext.actor === "sokoBot") {
    return {
      archivedAt: null,
      workspaceId,
      assigneeSokoBotId: authContext.sokoBotId,
      status: { not: TaskStatus.DRAFT },
      AND: [buildSokoBotOwnerTaskVisibilityWhere(authContext.userId)],
    };
  }

  if (authContext.actor !== "coworker") {
    if (authContext.actor === "user") {
      return buildHumanTaskVisibilityWhere(authContext.userId);
    }
    return undefined;
  }

  await requireCoworkerCapability(authContext.coworkerId, "tasks");
  const hasWorkspaceGrant = authContext.context
    ? await hasGrantedWorkspaceAccess({
        vendorId: authContext.vendorId,
        workspaceId,
      })
    : false;

  return {
    archivedAt: null,
    ...buildCoworkerTaskListAccessFilter({
      coworkerId: authContext.coworkerId,
      vendorId: authContext.vendorId,
      hasWorkspaceGrant,
    }),
  };
}

function encodeCursor(item: { id: string; scheduledAt: string }): string {
  return Buffer.from(JSON.stringify(item), "utf8").toString("base64url");
}

function isCalendarCursor(value: unknown): value is CalendarCursor {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "scheduledAt" in value &&
    typeof value.id === "string" &&
    typeof value.scheduledAt === "string" &&
    !Number.isNaN(new Date(value.scheduledAt).getTime())
  );
}

function decodeCursor(cursor: string): CalendarCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw badRequest("cursor is invalid");
  }
  if (!isCalendarCursor(parsed)) {
    throw badRequest("cursor is invalid");
  }
  return parsed;
}

function validateRange(from: string, to: string): { from: Date; to: Date } {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    toDate <= fromDate
  ) {
    throw badRequest("to must be after from");
  }
  if (toDate.getTime() - fromDate.getTime() > CALENDAR_OCCURRENCE_HORIZON_MS) {
    throw badRequest("Calendar range cannot exceed 90 days");
  }
  if (toDate.getTime() > Date.now() + CALENDAR_OCCURRENCE_HORIZON_MS) {
    throw badRequest(
      "Calendar browse range cannot extend beyond the next 90 days",
    );
  }
  return { from: fromDate, to: toDate };
}

export function parseWorkspaceCalendarQuery(
  query: z.infer<typeof workspaceCalendarQuerySchema>,
): WorkspaceCalendarReadQuery {
  const { from, to } = validateRange(query.from, query.to);
  return {
    includeSocialPosts: query.includeSocialPosts === "true",
    assigneeId: query.assigneeId,
    assigneeUserId: query.assigneeUserId,
    from,
    to,
    cursor: query.cursor ? decodeCursor(query.cursor) : null,
    requestedCursor: query.cursor ?? null,
    limit: query.limit,
    scope: query.scope,
    status: query.status,
  };
}

function isPersistedOccurrenceCursor(
  cursor: CalendarCursor | null,
): cursor is CalendarCursor {
  return cursor !== null && z.uuid().safeParse(cursor.id).success;
}

function getNonProjectSourceFilter(
  workspaceId: string,
  sourceId: string | undefined,
): Prisma.TaskScheduleOccurrenceWhereInput {
  if (!sourceId) {
    return {};
  }

  if (sourceId === `workspace:${workspaceId}`) {
    return { sourceType: CalendarSourceType.WORKSPACE };
  }

  if (sourceId === `legacy-unknown:${workspaceId}`) {
    return { sourceType: CalendarSourceType.LEGACY_UNKNOWN };
  }

  throw notFound("Calendar source not found");
}

export async function readWorkspaceCalendar(
  workspaceId: string,
  userId: string,
  query: WorkspaceCalendarReadQuery,
  options: WorkspaceCalendarReadOptions = {},
) {
  if (options.projectId && options.sourceId) {
    throw badRequest("projectId and sourceId cannot be combined");
  }

  const { cursor, from, to } = query;
  const maxCandidates = query.limit + 1;
  const sourceFilter = getNonProjectSourceFilter(workspaceId, options.sourceId);
  const taskFilters: Prisma.TaskWhereInput[] = [
    { archivedAt: null },
    ...(options.taskWhere ? [options.taskWhere] : []),
    ...(query.scope === "owned" ||
    query.assigneeId ||
    query.assigneeUserId ||
    query.status
      ? [
          {
            ...(query.scope === "owned" ? { ownerId: userId } : {}),
            ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
            ...(query.assigneeUserId
              ? { assigneeUserId: query.assigneeUserId }
              : {}),
            ...(query.status ? { status: query.status } : {}),
          },
        ]
      : []),
  ];
  const taskVisibilityFilters: Prisma.TaskScheduleOccurrenceWhereInput[] =
    taskFilters.map((taskWhere) => ({
      OR: [
        {
          state: {
            in: [
              TaskScheduleOccurrenceState.PLANNED,
              TaskScheduleOccurrenceState.SKIPPED,
            ],
          },
          seriesTask: { is: taskWhere },
        },
        {
          state: TaskScheduleOccurrenceState.RELEASED,
          releasedTask: { is: taskWhere },
        },
        {
          state: TaskScheduleOccurrenceState.RELEASED,
          releasedTaskId: null,
          seriesTask: { is: taskWhere },
        },
      ],
    }));
  const cursorFilter: Prisma.TaskScheduleOccurrenceWhereInput | null = cursor
    ? {
        OR: [
          { effectiveScheduledAt: { gt: new Date(cursor.scheduledAt) } },
          ...(isPersistedOccurrenceCursor(cursor)
            ? [
                {
                  effectiveScheduledAt: new Date(cursor.scheduledAt),
                  id: { gt: cursor.id },
                },
              ]
            : []),
        ],
      }
    : null;
  const persistedOccurrenceBaseWhere = {
    sourceWorkspaceId: workspaceId,
    ...sourceFilter,
    ...(options.projectId
      ? {
          sourceProjectId: options.projectId,
          sourceType: CalendarSourceType.PROJECT,
        }
      : {}),
    state: {
      in: [
        TaskScheduleOccurrenceState.PLANNED,
        TaskScheduleOccurrenceState.SKIPPED,
        TaskScheduleOccurrenceState.RELEASED,
      ],
    },
    effectiveScheduledAt: { gte: from, lt: to },
    ...(taskVisibilityFilters.length > 0 ? { AND: taskVisibilityFilters } : {}),
  };
  const persistedOccurrenceWhere = {
    ...persistedOccurrenceBaseWhere,
    ...(cursorFilter
      ? taskVisibilityFilters.length > 0
        ? { AND: [...taskVisibilityFilters, cursorFilter] }
        : cursorFilter
      : {}),
  };
  const [occurrences, persistedOccurrenceCount] = await Promise.all([
    prisma.taskScheduleOccurrence.findMany({
      where: persistedOccurrenceWhere,
      take: maxCandidates,
      orderBy: [{ effectiveScheduledAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        scheduleVersion: true,
        seriesTaskId: true,
        originalScheduledAt: true,
        effectiveScheduledAt: true,
        state: true,
        sourceWorkspaceId: true,
        sourceType: true,
        sourceProjectId: true,
        sourceAccuracy: true,
        timeAccuracy: true,
        epochId: true,
        seriesTask: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            status: true,
            assigneeId: true,
            assigneeUserId: true,
            metadata: true,
            scheduleRevision: true,
          },
        },
        releasedTask: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            status: true,
            assigneeId: true,
            assigneeUserId: true,
          },
        },
      },
    }),
    prisma.taskScheduleOccurrence.count({
      where: persistedOccurrenceBaseWhere,
    }),
  ]);

  const persistedItems = occurrences
    .slice(0, maxCandidates)
    .map((occurrence) => {
      const task =
        occurrence.state === TaskScheduleOccurrenceState.RELEASED &&
        occurrence.releasedTask
          ? occurrence.releasedTask
          : occurrence.seriesTask;
      const schedule = parseTaskScheduleMetadata(
        occurrence.seriesTask.metadata,
      );
      const canEditSchedule =
        occurrence.state !== TaskScheduleOccurrenceState.RELEASED &&
        task.ownerId === userId;

      return workspaceCalendarItemSchema.parse({
        id: occurrence.id,
        taskId: task.id,
        canEditSchedule,
        canMutateOccurrence:
          canEditSchedule &&
          (occurrence.scheduleVersion === 2 || schedule?.mode === "once"),
        scheduleRevision: occurrence.seriesTask.scheduleRevision,
        taskName: task.name,
        taskStatus: task.status,
        taskAssigneeId: task.assigneeId,
        taskAssigneeUserId: task.assigneeUserId,
        taskOwnerId: task.ownerId,
        scheduledAt: occurrence.effectiveScheduledAt.toISOString(),
        originalScheduledAt:
          occurrence.originalScheduledAt?.toISOString() ?? null,
        state: occurrence.state,
        sourceId: getCalendarSourceId(occurrence),
        sourceWorkspaceId: occurrence.sourceWorkspaceId,
        sourceType: occurrence.sourceType,
        sourceProjectId: occurrence.sourceProjectId,
        sourceAccuracy: occurrence.sourceAccuracy,
        timeAccuracy: occurrence.timeAccuracy,
      });
    });
  const includePosts =
    query.includeSocialPosts &&
    !options.sourceId &&
    !query.assigneeId &&
    !query.assigneeUserId &&
    !query.status;
  const socialBaseWhere: Prisma.SocialPostWhereInput = {
    workspaceId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(query.scope === "owned" ? { scheduledByUserId: userId } : {}),
    status: { not: "DRAFT" },
    scheduledAt: { gte: from, lt: to },
  };
  const socialCursor: Prisma.SocialPostWhereInput = cursor
    ? {
        OR: [
          { scheduledAt: { gt: new Date(cursor.scheduledAt) } },
          {
            scheduledAt: new Date(cursor.scheduledAt),
            ...(cursor.id.startsWith("social:")
              ? { id: { gt: cursor.id.slice(7) } }
              : {}),
          },
        ],
      }
    : {};
  const [posts, postCount] = includePosts
    ? await Promise.all([
        prisma.socialPost.findMany({
          where: { ...socialBaseWhere, ...socialCursor },
          take: maxCandidates,
          orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            text: true,
            status: true,
            scheduledAt: true,
            projectId: true,
            workspaceId: true,
            socialConnection: { select: { externalHandle: true } },
            project: { select: { name: true } },
            scheduledByUser: { select: { name: true } },
            media: true,
          },
        }),
        prisma.socialPost.count({ where: socialBaseWhere }),
      ])
    : [[], 0];
  const socialItems = posts.map((post) =>
    socialPostCalendarItemSchema.parse({
      kind: "socialPost",
      id: `social:${post.id}`,
      postId: post.id,
      text: post.text,
      status: post.status,
      externalHandle: post.socialConnection?.externalHandle ?? null,
      projectName: post.project.name,
      scheduledByName: post.scheduledByUser?.name ?? null,
      attachmentCount: parseSocialPostMedia(post.media, post.id).length,
      scheduledAt: post.scheduledAt?.toISOString(),
      sourceId: `project:${post.projectId}`,
      sourceProjectId: post.projectId,
      sourceWorkspaceId: post.workspaceId,
      sourceType: "PROJECT",
    }),
  );
  const merged: z.infer<typeof workspaceCalendarEntrySchema>[] = [
    ...persistedItems,
    ...socialItems,
  ];
  merged.sort(
    (a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const page = merged.slice(0, query.limit);
  const hasMore = merged.length > page.length;

  return {
    items: page,
    pagination: {
      cursor: query.requestedCursor,
      limit: query.limit,
      total: persistedOccurrenceCount + postCount,
      nextCursor: hasMore
        ? encodeCursor({
            id: page[page.length - 1]!.id,
            scheduledAt: page[page.length - 1]!.scheduledAt,
          })
        : null,
    },
  };
}
