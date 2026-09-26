import "server-only";

import { isValidTimezone } from "@sokosumi/utils";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Temporal } from "temporal-polyfill";
import { listTaskAssigneeOptions } from "@/app/tasks/utils/task-assignee-options";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { getSession } from "@/lib/auth/auth.server";
import {
  type Project,
  TaskStatus,
  type WorkspaceCalendarItem,
  type WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import {
  getCalendarRange,
  getLatestCalendarDate,
  resolveCalendarDate,
} from "@/lib/schedules/calendar-range";
import { projectService } from "@/lib/services/project.service";
import {
  taskService,
  type WorkspaceCalendarPage,
} from "@/lib/services/task.service";
import type { CoworkerOption } from "@/lib/types/coworker";

export interface CalendarPageSearchParams {
  assigneeId?: string;
  assigneeUserId?: string;
  date?: string;
  projectId?: string;
  sourceId?: string;
  scope?: string;
  status?: string;
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
  items: WorkspaceCalendarItem[];
  latestDate: string;
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
) {
  const calendarStatus = Object.values(TaskStatus).find(
    (taskStatus) => taskStatus === status,
  );
  const now = new Date();
  const latestCalendarDate = getLatestCalendarDate(now);
  const today = Temporal.Now.plainDateISO(
    isValidTimezone(timezone) ? timezone : "UTC",
  );
  const initialDate =
    view === "agenda" ? today.toString() : resolveCalendarDate(date, now);
  const from = new Date(
    today.toZonedDateTime(isValidTimezone(timezone) ? timezone : "UTC")
      .epochMilliseconds,
  );
  const range =
    view === "agenda"
      ? { from, to: new Date(from.getTime() + 90 * 24 * 60 * 60 * 1000) }
      : getCalendarRange(initialDate);

  return { calendarStatus, latestCalendarDate, initialDate, range };
}

export async function loadCalendarPageContext(
  activeOrganizationId: string | null,
  options: { requireSources?: boolean } = {},
) {
  const [sources, coworkerOptions] = await Promise.all([
    taskService.getWorkspaceCalendarSources().catch((error: unknown) => {
      if (options.requireSources) throw error;
      return [];
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
}: {
  projectId?: string;
  searchParams: Promise<CalendarPageSearchParams>;
}): Promise<LoadedWorkspaceCalendarPage> {
  await connection();
  const session = await getSession();
  const params = await searchParams;
  const { calendarStatus, latestCalendarDate, initialDate, range } =
    resolveCalendarPageQuery(
      params.date,
      params.status,
      params.view,
      params.timezone,
    );
  const activeOrganizationId = session?.session?.activeOrganizationId ?? null;
  const scope = params.scope === "owned" ? "owned" : "workspace";
  const latestDate = format(latestCalendarDate, "yyyy-MM-dd");

  if (routeProjectId) {
    const project = await projectService.getProjectById(routeProjectId);
    if (!project) {
      notFound();
    }

    const [{ items, pagination }, { sources, coworkerOptions }] =
      await Promise.all([
        projectService.getProjectCalendar(project.id, {
          ...range,
          assigneeId: params.assigneeId,
          assigneeUserId: params.assigneeUserId,
          limit: params.view === "agenda" ? 10 : 100,
          scope,
          status: calendarStatus,
        }),
        loadCalendarPageContext(activeOrganizationId),
      ]);
    const sourceId = `project:${project.id}`;
    const projectSource = sources.find(
      (source) => source.sourceId === sourceId,
    );

    return {
      activeOrganizationId,
      currentUserId: session?.user?.id ?? null,
      workspaceId: project.workspaceId,
      calendarKey: `${project.id}-${initialDate}-${params.scope ?? "workspace"}-${params.assigneeId ?? "all"}-${calendarStatus ?? "all"}-${params.view ?? "all"}`,
      coworkerOptions,
      initialDate,
      items,
      latestDate,
      pagination,
      project,
      projectOptions: [projectOptionFromProject(project)],
      range,
      sources: projectSource ? [projectSource] : [],
    };
  }

  const [
    { items, pagination },
    { sources, coworkerOptions },
    allProjectOptions,
  ] = await Promise.all([
    taskService.getWorkspaceCalendar({
      ...range,
      assigneeId: params.assigneeId,
      assigneeUserId: params.assigneeUserId,
      limit: params.view === "agenda" ? 10 : 100,
      projectId: params.projectId,
      sourceId: params.sourceId,
      scope,
      status: calendarStatus,
    }),
    loadCalendarPageContext(activeOrganizationId, { requireSources: true }),
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
    calendarKey: `${initialDate}-${params.projectId ?? "all"}-${params.sourceId ?? "all"}-${params.scope ?? "workspace"}-${params.assigneeId ?? "all"}-${calendarStatus ?? "all"}-${params.view ?? "all"}`,
    coworkerOptions,
    initialDate,
    items,
    latestDate,
    pagination,
    project: null,
    projectOptions: allProjectOptions.filter((project) =>
      schedulableProjectIds.has(project.id),
    ),
    range,
    sources,
  };
}
