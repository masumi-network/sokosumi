import { format } from "date-fns";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { CalendarCreateTaskModal } from "@/app/calendar/components/calendar-create-task-modal";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import { CreateTaskModalProvider } from "@/app/tasks/components/create-task-modal";
import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { listTaskAssigneeMemberOptions } from "@/app/tasks/utils/task-assignee-members";
import { getSession } from "@/lib/auth/auth.server";
import { hasCurrentUserCalendarBetaAccess } from "@/lib/calendar-beta-access.server";
import { TaskStatus } from "@/lib/clients/generated/core";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import {
  getCalendarRange,
  getLatestCalendarDate,
  resolveCalendarDate,
} from "@/lib/schedules/calendar-range";
import { coworkerService } from "@/lib/services/coworker.service";
import {
  taskService,
  type WorkspaceCalendarPage,
} from "@/lib/services/task.service";

interface CalendarPageProps {
  searchParams: Promise<{
    assigneeId?: string;
    assigneeUserId?: string;
    date?: string;
    projectId?: string;
    sourceId?: string;
    scope?: string;
    status?: string;
    view?: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Calendar.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  await connection();
  const session = await getSession();
  if (!(await hasCurrentUserCalendarBetaAccess())) {
    notFound();
  }

  const {
    assigneeId,
    assigneeUserId,
    date,
    projectId,
    sourceId,
    scope,
    status,
    view,
  } = await searchParams;
  const isSchedulesView = view === "schedules";
  const calendarStatus = Object.values(TaskStatus).find(
    (taskStatus) => taskStatus === status,
  );
  const now = new Date();
  const latestCalendarDate = getLatestCalendarDate(now);
  const initialDate = resolveCalendarDate(date, now);
  const range = getCalendarRange(initialDate);
  const [
    occurrencePage,
    sources,
    coworkers,
    memberOptions,
    allProjectOptions,
    schedulePage,
  ] = await Promise.all([
    isSchedulesView
      ? Promise.resolve<WorkspaceCalendarPage>({ items: [], pagination: null })
      : taskService.getWorkspaceCalendar({
          ...range,
          assigneeId,
          assigneeUserId,
          limit: 100,
          projectId,
          sourceId,
          scope: scope === "owned" ? "owned" : "workspace",
          status: calendarStatus,
        }),
    taskService.getWorkspaceCalendarSources(),
    coworkerService.listCoworkers().catch(() => []),
    listTaskAssigneeMemberOptions(
      session?.session?.activeOrganizationId ?? null,
    ),
    getProjectFilterOptions(projectId),
    isSchedulesView
      ? taskService.listTasks({
          hasSchedule: true,
          sort: "nextRunAt",
          scope: scope === "owned" ? "owned" : "workspace",
          projectId: projectId ?? undefined,
          status: calendarStatus,
          assigneeId,
          assigneeUserId,
          limit: 100,
        })
      : Promise.resolve(null),
  ]);
  const { items, pagination } = occurrencePage;
  const coworkerOptions = [...memberOptions, ...getCoworkerOptions(coworkers)];
  const workspaceSource = sources.find(
    (source) =>
      source.sourceType === "WORKSPACE" &&
      source.sourceId.startsWith("workspace:"),
  );
  if (!workspaceSource) {
    throw new Error("Active Calendar workspace source is unavailable");
  }
  const workspaceId = workspaceSource.sourceId.slice("workspace:".length);
  const schedulableProjectIds = new Set(
    sources
      .filter(
        (source) => source.sourceType === "PROJECT" && source.isSchedulable,
      )
      .map((source) => source.sourceId.replace(/^project:/, "")),
  );
  const projectOptions = allProjectOptions.filter((project) =>
    schedulableProjectIds.has(project.id),
  );

  return (
    <CreateTaskModalProvider>
      <div className="w-full">
        <WorkspaceCalendar
          activeOrganizationId={session?.session?.activeOrganizationId ?? null}
          currentUserId={session?.user?.id ?? null}
          key={`${initialDate}-${projectId ?? "all"}-${sourceId ?? "all"}-${scope ?? "workspace"}-${assigneeId ?? "all"}-${calendarStatus ?? "all"}-${view ?? "all"}`}
          initialDate={initialDate}
          items={items}
          latestDate={format(latestCalendarDate, "yyyy-MM-dd")}
          sources={sources}
          workspaceId={workspaceId}
          pagination={pagination}
          range={range}
          coworkers={coworkerOptions}
          scheduledTasks={schedulePage?.tasks}
          scheduledTasksPagination={schedulePage?.pagination}
        />
        <CalendarCreateTaskModal
          coworkerOptions={coworkerOptions}
          projectOptions={projectOptions}
        />
      </div>
    </CreateTaskModalProvider>
  );
}
