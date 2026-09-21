import { format } from "date-fns";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { CalendarCreateTaskModal } from "@/app/calendar/components/calendar-create-task-modal";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import {
  loadCalendarPageContext,
  resolveCalendarPageQuery,
} from "@/app/calendar/load-calendar-page";
import { CreateTaskModalProvider } from "@/app/tasks/components/create-task-modal";
import { getSession } from "@/lib/auth/auth.server";
import { hasCurrentUserCalendarBetaAccess } from "@/lib/calendar-beta-access.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { taskService } from "@/lib/services/task.service";

interface CalendarPageProps {
  searchParams: Promise<{
    assigneeId?: string;
    assigneeUserId?: string;
    date?: string;
    projectId?: string;
    sourceId?: string;
    scope?: string;
    status?: string;
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
  } = await searchParams;
  const { calendarStatus, latestCalendarDate, initialDate, range } =
    resolveCalendarPageQuery(date, status);
  const [
    { items, pagination },
    { sources, coworkerOptions },
    allProjectOptions,
  ] = await Promise.all([
    taskService.getWorkspaceCalendar({
      ...range,
      assigneeId,
      assigneeUserId,
      limit: 100,
      projectId,
      sourceId,
      scope: scope === "owned" ? "owned" : "workspace",
      status: calendarStatus,
    }),
    loadCalendarPageContext(session?.session?.activeOrganizationId ?? null),
    getProjectFilterOptions(projectId),
  ]);
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
          key={`${initialDate}-${projectId ?? "all"}-${sourceId ?? "all"}-${scope ?? "workspace"}-${assigneeId ?? "all"}-${calendarStatus ?? "all"}`}
          initialDate={initialDate}
          items={items}
          latestDate={format(latestCalendarDate, "yyyy-MM-dd")}
          sources={sources}
          pagination={pagination}
          range={range}
          coworkers={coworkerOptions}
        />
        <CalendarCreateTaskModal
          coworkerOptions={coworkerOptions}
          projectOptions={projectOptions}
        />
      </div>
    </CreateTaskModalProvider>
  );
}
