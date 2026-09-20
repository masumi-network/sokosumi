import { format } from "date-fns";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarCreateTaskModal } from "@/app/calendar/components/calendar-create-task-modal";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import {
  loadCalendarPageContext,
  resolveCalendarPageQuery,
} from "@/app/calendar/load-calendar-page";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { PROJECTS_CALENDAR_SHELL_CLASS } from "@/app/projects/constants";
import { CreateTaskModalProvider } from "@/app/tasks/components/create-task-modal";
import { getSession } from "@/lib/auth/auth.server";
import { hasCurrentUserCalendarBetaAccess } from "@/lib/calendar-beta-access.server";
import { projectService } from "@/lib/services/project.service";

interface ProjectCalendarPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    assigneeId?: string;
    assigneeUserId?: string;
    date?: string;
    scope?: string;
    status?: string;
  }>;
}

export default async function ProjectCalendarPage({
  params,
  searchParams,
}: ProjectCalendarPageProps) {
  await connection();
  const session = await getSession();
  if (!(await hasCurrentUserCalendarBetaAccess())) {
    notFound();
  }

  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);
  if (!project) {
    notFound();
  }

  const { assigneeId, assigneeUserId, date, scope, status } =
    await searchParams;
  const { calendarStatus, latestCalendarDate, initialDate, range } =
    resolveCalendarPageQuery(date, status);
  const [{ items, pagination }, { sources, coworkerOptions }, t, formatter] =
    await Promise.all([
      projectService.getProjectCalendar(project.id, {
        ...range,
        assigneeId,
        assigneeUserId,
        limit: 100,
        scope: scope === "owned" ? "owned" : "workspace",
        status: calendarStatus,
      }),
      loadCalendarPageContext(session?.session?.activeOrganizationId ?? null),
      getTranslations("App.Projects.Detail"),
      getFormatter(),
    ]);
  const sourceId = `project:${project.id}`;
  const projectSource = sources.find((source) => source.sourceId === sourceId);
  const projectOptions = [
    {
      id: project.id,
      name: project.name,
      logo: project.logo,
      designMd: project.designMd,
      briefingUrl: project.briefingUrl,
      contextMd: project.contextMd,
    },
  ];

  return (
    <CreateTaskModalProvider initialProjectId={project.id}>
      <div className={PROJECTS_CALENDAR_SHELL_CLASS}>
        <ProjectDetailHeader
          backHref={`/projects/${project.id}`}
          backLabel={t("backToProject")}
          metadata={[
            {
              label: t("header.updated"),
              value: formatter.dateTime(project.updatedAt, "dateTime"),
            },
            {
              label: t("header.created"),
              value: formatter.dateTime(project.createdAt, "dateTime"),
            },
          ]}
          projectLogo={project.logo}
          projectName={project.name}
          showBackOnMobile
          websiteUrl={project.websiteUrl}
        />

        <div className="mt-6 w-full">
          <WorkspaceCalendar
            activeOrganizationId={
              session?.session?.activeOrganizationId ?? null
            }
            initialDate={initialDate}
            items={items}
            key={`${project.id}-${initialDate}-${scope ?? "workspace"}-${assigneeId ?? "all"}-${calendarStatus ?? "all"}`}
            latestDate={format(latestCalendarDate, "yyyy-MM-dd")}
            pagination={pagination}
            lockedProjectId={project.id}
            range={range}
            sources={projectSource ? [projectSource] : []}
            coworkers={coworkerOptions}
          />
        </div>
        <CalendarCreateTaskModal
          coworkerOptions={coworkerOptions}
          projectOptions={projectOptions}
          lockProjectSelection
        />
      </div>
    </CreateTaskModalProvider>
  );
}
