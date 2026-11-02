import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { requireCoworkerCapability } from "@/helpers/access-control";
import { badRequest, notFound } from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import {
  buildHumanTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
} from "@/helpers/task-visibility";
import {
  buildCoworkerTaskListAccessFilter,
  hasGrantedWorkspaceAccess,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  requirePersonalSokoBotAuthContext,
  resolveUserContext,
} from "@/middleware/auth";
import {
  type CalendarType,
  workspaceCalendarQuerySchema,
} from "@/schemas/workspace-calendar.schema";
import { RUN_HORIZON_MS } from "@/services/task-schedule-runs.service";

import { readContacts } from "./read-contacts.js";
import { readMarketing } from "./read-marketing.js";
import { readNewsletter } from "./read-newsletter.js";
import {
  type CalendarAccessWhere,
  type CalendarCursor,
  type CalendarEntry,
  type CalendarReader,
  compareEntries,
  type WorkspaceCalendarReadOptions,
  type WorkspaceCalendarReadQuery,
} from "./read-shared.js";
import { readSocial } from "./read-social.js";
import { readTasks } from "./read-tasks.js";
import {
  getCalendarBrowseEnd,
  scheduledSocialPostWhere,
} from "./social-post-range.js";

const READERS: Record<CalendarType, CalendarReader> = {
  tasks: readTasks,
  social: readSocial,
  newsletter: readNewsletter,
  contacts: readContacts,
  marketing: readMarketing,
};

export async function getCalendarAccessWhere(
  authContext: AuthenticationContext,
  workspaceId: string,
): Promise<CalendarAccessWhere | undefined> {
  const userContext = resolveUserContext(authContext);
  if (userContext) {
    await requireAssignedOrganizationSeat(
      userContext.userId,
      userContext.organizationId,
    );
  }
  // Soko Bots do not work with Task Schedules; they see the Tasks created.
  if (authContext.actor === "sokoBot") {
    return {
      scheduleReader: null,
      task: {
        archivedAt: null,
        workspaceId,
        assigneeSokoBotId: authContext.sokoBotId,
        status: { not: TaskStatus.DRAFT },
        AND: [
          buildSokoBotOwnerTaskVisibilityWhere(
            requirePersonalSokoBotAuthContext(authContext).userId,
          ),
        ],
      },
    };
  }

  if (authContext.actor !== "coworker") {
    if (authContext.actor === "user") {
      return {
        scheduleReader: { kind: "user", userId: authContext.userId },
        task: buildHumanTaskVisibilityWhere(authContext.userId),
      };
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
    // A Coworker reads Task Schedules only with a GRANTED workspace grant.
    scheduleReader:
      hasWorkspaceGrant && authContext.context
        ? {
            kind: "coworker",
            coworkerId: authContext.coworkerId,
            vendorId: authContext.vendorId,
            userId: authContext.context.userId,
          }
        : null,
    task: {
      archivedAt: null,
      ...buildCoworkerTaskListAccessFilter({
        coworkerId: authContext.coworkerId,
        vendorId: authContext.vendorId,
        hasWorkspaceGrant,
      }),
    },
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
  if (toDate.getTime() - fromDate.getTime() > RUN_HORIZON_MS) {
    throw badRequest("Calendar range cannot exceed 90 days");
  }
  return { from: fromDate, to: toDate };
}

export function parseWorkspaceCalendarQuery(
  query: z.infer<typeof workspaceCalendarQuerySchema>,
): WorkspaceCalendarReadQuery {
  const { from, to } = validateRange(query.from, query.to);
  return {
    includeSocialPosts: query.includeSocialPosts === "true",
    types: query.types,
    timeZone: query.timeZone,
    agendaOnly: query.agendaOnly === "true",
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

/** Without `types` the answer is today's: Tasks, plus Social posts when asked. */
function requestedTypes(query: WorkspaceCalendarReadQuery): CalendarType[] {
  return (
    query.types ?? [
      "tasks",
      ...(query.includeSocialPosts ? ["social" as const] : []),
    ]
  );
}

/** Whether the request needs more than Tasks, and so an interactive session. */
export function requestsFeatures(
  query: Pick<
    z.infer<typeof workspaceCalendarQuerySchema>,
    "types" | "includeSocialPosts"
  >,
): boolean {
  return query.types
    ? query.types.some((type) => type !== "tasks")
    : query.includeSocialPosts === "true";
}

/**
 * The Calendar reads one feature at a time (Tasks, Social posts, Newsletter
 * issues, Contact follow-ups, the Marketing plan) and pages their entries
 * together by time, then id. Task-only filters leave out every other
 * feature, and so does a workspace source except for Contacts.
 */
export async function readWorkspaceCalendar(
  workspaceId: string,
  userId: string,
  query: WorkspaceCalendarReadQuery,
  options: WorkspaceCalendarReadOptions = {},
) {
  if (options.projectId && options.sourceId) {
    throw badRequest("projectId and sourceId cannot be combined");
  }

  const hasTaskOnlyFilter = Boolean(
    query.assigneeId || query.assigneeUserId || query.status,
  );
  const fromProjects = !options.sourceId && !hasTaskOnlyFilter;
  const applies: Record<CalendarType, boolean> = {
    tasks: true,
    social: fromProjects,
    newsletter: fromProjects,
    marketing: fromProjects && query.scope !== "owned",
    contacts: !options.projectId && !hasTaskOnlyFilter,
  };
  const types = requestedTypes(query).filter((type) => applies[type]);

  if (query.to.getTime() > Date.now() + RUN_HORIZON_MS) {
    const latestPost = types.includes("social")
      ? await prisma.socialPost.aggregate({
          where: scheduledSocialPostWhere(
            workspaceId,
            userId,
            query.scope,
            options.projectId,
          ),
          _max: { scheduledAt: true },
        })
      : null;
    if (
      query.to >
      getCalendarBrowseEnd(new Date(), latestPost?._max.scheduledAt ?? null)
    ) {
      throw badRequest(
        "Calendar browse range cannot extend beyond the next 90 days or the latest scheduled Social post's month",
      );
    }
  }

  if (options.sourceId && options.sourceId !== `workspace:${workspaceId}`) {
    throw notFound("Calendar source not found");
  }

  const results = await Promise.all(
    types.map((type) => READERS[type]({ workspaceId, userId, query, options })),
  );
  const merged: CalendarEntry[] = results
    .flatMap((result) => result.items)
    .sort(compareEntries);
  const page = merged.slice(0, query.limit);
  const hasMore = merged.length > page.length;

  return {
    items: page,
    pagination: {
      cursor: query.requestedCursor,
      limit: query.limit,
      total: results.reduce((sum, result) => sum + result.total, 0),
      nextCursor: hasMore
        ? encodeCursor({
            id: page[page.length - 1]!.id,
            scheduledAt: page[page.length - 1]!.scheduledAt,
          })
        : null,
    },
  };
}
