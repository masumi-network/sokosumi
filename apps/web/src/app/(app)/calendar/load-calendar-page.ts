import "server-only";

import {
  type Project,
  TaskStatus,
  type WorkspaceCalendarEntry,
  type WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import { isValidTimezone } from "@sokosumi/utils";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Temporal } from "temporal-polyfill";
import { listTaskAssigneeOptions } from "@/app/tasks/utils/task-assignee-options";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { getSession } from "@/lib/auth/auth.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { isNewsletterEnabled } from "@/lib/newsletter-access.server";
import {
  getCalendarRange,
  getLatestCalendarDate,
  resolveCalendarDate,
} from "@/lib/schedules/calendar-range";
import { utcToDateTimeLocalInTimezone } from "@/lib/schedules/zoned-datetime";
import { projectService } from "@/lib/services/project.service";
import {
  taskService,
  type WorkspaceCalendarPage,
} from "@/lib/services/task.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import {
  availableCalendarTypes,
  type CalendarType,
  calendarTypesQuery,
  isSocialOnly,
  parseCalendarTypes,
  selectedCalendarTypes,
} from "./calendar-types";

export interface CalendarPageSearchParams {
  assigneeId?: string;
  assigneeUserId?: string;
  date?: string;
  projectId?: string;
  scope?: string;
  /** The Show filter: comma-separated `CalendarType`s. */
  types?: string;
  status?: string;
  postStatus?: string;
  provider?: string;
  view?: string;
  timezone?: string;
}

export interface LoadedWorkspaceCalendarPage {
  activeOrganizationId: string | null;
  currentUserId: string | null;
  workspaceId: string;
  calendarKey: string;
  coworkerOptions: CoworkerOption[];
  initialDate: string;
  items: WorkspaceCalendarEntry[];
  latestDate: string;
  newsletterEnabled: boolean;
  pagination: WorkspaceCalendarPage["pagination"];
  project: Project | null;
  projectOptions: ProjectFilterOption[];
  range: { from: Date; to: Date };
  sources: WorkspaceCalendarSource[];
}

export function resolveCalendarPageQuery(
  date: string | undefined,
  status: string | undefined,
  view?: string,
  timezone?: string,
  latestScheduledSocialPostAt?: Date | null,
) {
  const calendarStatus = Object.values(TaskStatus).find(
    (taskStatus) => taskStatus === status,
  );
  const now = new Date();
  const calendarTimezone = isValidTimezone(timezone) ? timezone : "UTC";
  const latestScheduledCalendarDate = latestScheduledSocialPostAt
    ? new Date(
        utcToDateTimeLocalInTimezone(
          latestScheduledSocialPostAt,
          calendarTimezone,
        ),
      )
    : null;
  const latestCalendarDate = getLatestCalendarDate(
    now,
    latestScheduledCalendarDate,
  );
  const today = Temporal.Now.plainDateISO(calendarTimezone);
  const initialDate =
    view === "agenda"
      ? today.toString()
      : resolveCalendarDate(date, now, latestScheduledCalendarDate);
  const from = new Date(
    today.toZonedDateTime(calendarTimezone).epochMilliseconds,
  );
  const range =
    view === "agenda"
      ? { from, to: new Date(from.getTime() + 90 * 24 * 60 * 60 * 1000) }
      : getCalendarRange(initialDate);

  return {
    calendarStatus,
    calendarTimezone,
    latestCalendarDate,
    initialDate,
    range,
  };
}

export async function loadCalendarPageContext(
  activeOrganizationId: string | null,
  options: { scope?: "owned" | "workspace" } = {},
) {
  const [sources, coworkerOptions] = await Promise.all([
    taskService.getWorkspaceCalendarSources({
      includeSocialPosts: "true",
      scope: options.scope,
    }),
    listTaskAssigneeOptions(activeOrganizationId),
  ]);

  return {
    sources,
    coworkerOptions,
  };
}

function projectOptionFromProject(project: Project): ProjectFilterOption {
  return {
    id: project.id,
    name: project.name,
    logo: project.logo,
    designMd: project.designMd,
    briefingUrl: project.briefingUrl,
    contextMd: project.contextMd,
  };
}

export async function loadWorkspaceCalendarPage({
  projectId: routeProjectId,
  searchParams,
  types,
}: {
  projectId?: string;
  searchParams: Promise<CalendarPageSearchParams>;
  /** An embed's fixed features; otherwise the URL's `types`, default every one. */
  types?: readonly CalendarType[];
}): Promise<LoadedWorkspaceCalendarPage> {
  await connection();
  const session = await getSession();
  const requested = await searchParams;
  const activeOrganizationId = session?.session?.activeOrganizationId ?? null;
  const scope: "owned" | "workspace" =
    requested.scope === "owned" ? "owned" : "workspace";
  const [{ sources, coworkerOptions }, project, newsletterEnabled] =
    await Promise.all([
      loadCalendarPageContext(activeOrganizationId, { scope }),
      routeProjectId
        ? projectService.getProjectById(routeProjectId)
        : Promise.resolve(null),
      isNewsletterEnabled(),
    ]);
  if (routeProjectId && !project) {
    notFound();
  }
  const selectedTypes: readonly CalendarType[] =
    types ??
    selectedCalendarTypes(
      parseCalendarTypes(requested.types),
      availableCalendarTypes(newsletterEnabled),
    );
  // Social posts alone have no agenda list; a month grid is shown instead.
  const params =
    requested.view === "agenda" && isSocialOnly(selectedTypes)
      ? { ...requested, view: undefined }
      : requested;
  const selectedProjectId = routeProjectId ?? params.projectId;
  const socialPostsVisible =
    !params.assigneeId &&
    !params.assigneeUserId &&
    !Object.values(TaskStatus).some((status) => status === params.status);
  const latestScheduledSocialPostAt = socialPostsVisible
    ? sources.reduce<Date | null>((latest, source) => {
        if (
          selectedProjectId &&
          source.sourceId !== `project:${selectedProjectId}`
        ) {
          return latest;
        }
        const scheduledAt = source.latestScheduledSocialPostAt;
        return scheduledAt && (!latest || scheduledAt > latest)
          ? scheduledAt
          : latest;
      }, null)
    : null;
  const {
    calendarStatus,
    calendarTimezone,
    latestCalendarDate,
    initialDate,
    range,
  } = resolveCalendarPageQuery(
    params.date,
    params.status,
    params.view,
    params.timezone,
    latestScheduledSocialPostAt,
  );
  const latestDate = format(latestCalendarDate, "yyyy-MM-dd");
  const typesQuery = calendarTypesQuery(selectedTypes);
  const calendarQuery = {
    ...range,
    types: typesQuery,
    timeZone: calendarTimezone,
    agendaOnly: params.view === "agenda" ? ("true" as const) : undefined,
    assigneeId: params.assigneeId,
    assigneeUserId: params.assigneeUserId,
    limit: params.view === "agenda" ? 10 : 100,
    scope,
    status: calendarStatus,
  };

  if (project) {
    const { items, pagination } = await projectService.getProjectCalendar(
      project.id,
      calendarQuery,
    );
    const sourceId = `project:${project.id}`;
    const projectSource = sources.find(
      (source) => source.sourceId === sourceId,
    );

    return {
      activeOrganizationId,
      currentUserId: session?.user?.id ?? null,
      workspaceId: project.workspaceId,
      calendarKey: `${project.id}-${initialDate}-${params.scope ?? "workspace"}-${params.assigneeId ?? "all"}-${calendarStatus ?? "all"}-${params.view ?? "all"}-${typesQuery}`,
      coworkerOptions,
      initialDate,
      items,
      latestDate,
      newsletterEnabled,
      pagination,
      project,
      projectOptions: [projectOptionFromProject(project)],
      range,
      sources: projectSource ? [projectSource] : [],
    };
  }

  const [{ items, pagination }, allProjectOptions] = await Promise.all([
    taskService.getWorkspaceCalendar({
      ...calendarQuery,
      projectId: params.projectId,
    }),
    getProjectFilterOptions(params.projectId),
  ]);
  const workspaceSource = sources.find(
    (source) => source.sourceType === "WORKSPACE",
  );
  if (!workspaceSource)
    throw new Error("Calendar workspace source unavailable");
  const workspaceId = workspaceSource.sourceId.replace(/^workspace:/, "");
  const schedulableProjectIds = new Set(
    sources
      .filter(
        (source) => source.sourceType === "PROJECT" && source.isSchedulable,
      )
      .map((source) => source.sourceId.replace(/^project:/, "")),
  );

  return {
    activeOrganizationId,
    currentUserId: session?.user?.id ?? null,
    workspaceId,
    calendarKey: `${initialDate}-${params.projectId ?? "all"}-${params.scope ?? "workspace"}-${params.assigneeId ?? "all"}-${calendarStatus ?? "all"}-${params.view ?? "all"}-${typesQuery}`,
    coworkerOptions,
    initialDate,
    items,
    latestDate,
    newsletterEnabled,
    pagination,
    project: null,
    projectOptions: allProjectOptions.filter((project) =>
      schedulableProjectIds.has(project.id),
    ),
    range,
    sources,
  };
}
