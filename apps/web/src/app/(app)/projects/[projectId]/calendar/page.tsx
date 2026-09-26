import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarCreateTaskModal } from "@/app/calendar/components/calendar-create-task-modal";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import {
  type CalendarPageSearchParams,
  loadWorkspaceCalendarPage,
} from "@/app/calendar/load-calendar-page";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { CreateTaskModalProvider } from "@/app/tasks/components/create-task-modal";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

interface ProjectCalendarPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<CalendarPageSearchParams>;
}

export default async function ProjectCalendarPage({
  params,
  searchParams,
}: ProjectCalendarPageProps) {
  const { projectId } = await params;
  const [page, t, formatter, socialBetaEnabled] = await Promise.all([
    loadWorkspaceCalendarPage({ projectId, searchParams }),
    getTranslations("App.Projects.Detail"),
    getFormatter(),
    hasCurrentUserSocialBetaAccess(),
  ]);
  const workspaceLabels = await getProjectWorkspaceLabels();
  const project = page.project;
  if (!project) {
    notFound();
  }

  return (
    <CreateTaskModalProvider initialProjectId={project.id}>
      <ProjectWorkspaceShell
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
        labels={workspaceLabels}
        projectId={project.id}
        projectLogo={project.logo}
        projectName={project.name}
        showSocialTab={socialBetaEnabled}
        websiteUrl={project.websiteUrl}
      >
        <div className="w-full">
          <WorkspaceCalendar
            activeOrganizationId={page.activeOrganizationId}
            currentUserId={page.currentUserId}
            workspaceId={project.workspaceId}
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
      </ProjectWorkspaceShell>
    </CreateTaskModalProvider>
  );
}
