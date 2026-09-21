import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarCreateTaskModal } from "@/app/calendar/components/calendar-create-task-modal";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import {
  type CalendarPageSearchParams,
  loadWorkspaceCalendarPage,
} from "@/app/calendar/load-calendar-page";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { PROJECTS_CALENDAR_SHELL_CLASS } from "@/app/projects/constants";
import { CreateTaskModalProvider } from "@/app/tasks/components/create-task-modal";

interface ProjectCalendarPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<CalendarPageSearchParams>;
}

export default async function ProjectCalendarPage({
  params,
  searchParams,
}: ProjectCalendarPageProps) {
  const { projectId } = await params;
  const [page, t, formatter] = await Promise.all([
    loadWorkspaceCalendarPage({ projectId, searchParams }),
    getTranslations("App.Projects.Detail"),
    getFormatter(),
  ]);
  const project = page.project;
  if (!project) {
    notFound();
  }

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
            activeOrganizationId={page.activeOrganizationId}
            initialDate={page.initialDate}
            items={page.items}
            key={page.calendarKey}
            latestDate={page.latestDate}
            pagination={page.pagination}
            lockedProjectId={project.id}
            range={page.range}
            sources={page.sources}
            coworkers={page.coworkerOptions}
          />
        </div>
        <CalendarCreateTaskModal
          coworkerOptions={page.coworkerOptions}
          projectOptions={page.projectOptions}
          lockProjectSelection
        />
      </div>
    </CreateTaskModalProvider>
  );
}
