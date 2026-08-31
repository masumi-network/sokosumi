import { format } from "date-fns";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { WorkspaceCalendar } from "@/app/calendar/components/workspace-calendar";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { getSession } from "@/lib/auth/auth.server";
import { isBetaAccessEmail } from "@/lib/beta-access";
import { TaskStatus } from "@/lib/clients/generated/core";
import {
  getCalendarRange,
  getLatestCalendarDate,
  resolveCalendarDate,
} from "@/lib/schedules/calendar-range";
import { coworkerService } from "@/lib/services/coworker.service";
import { projectService } from "@/lib/services/project.service";
import { formatShortDateTime } from "@/lib/utils/datetime";

interface ProjectCalendarPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    assigneeId?: string;
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
  if (!isBetaAccessEmail(session?.user.email)) {
    notFound();
  }

  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);
  if (!project) {
    notFound();
  }

  const { assigneeId, date, scope, status } = await searchParams;
  const calendarStatus = Object.values(TaskStatus).find(
    (taskStatus) => taskStatus === status,
  );
  const now = new Date();
  const initialDate = resolveCalendarDate(date, now);
  const latestCalendarDate = getLatestCalendarDate(now);
  const range = getCalendarRange(initialDate);
  const [{ items, pagination }, coworkers, t, locale] = await Promise.all([
    projectService.getProjectCalendar(project.id, {
      ...range,
      assigneeId,
      limit: 100,
      scope: scope === "owned" ? "owned" : "workspace",
      status: calendarStatus,
    }),
    coworkerService.listCoworkers().catch(() => []),
    getTranslations("App.Projects.Detail"),
    getLocale(),
  ]);
  const sourceId = `project:${project.id}`;

  return (
    <div className="min-h-full w-full px-4 py-6 md:px-6">
      <ProjectDetailHeader
        backHref={`/projects/${project.id}`}
        backLabel={t("backToProject")}
        metadata={[
          {
            label: t("header.updated"),
            value: formatShortDateTime(project.updatedAt, locale),
          },
          {
            label: t("header.created"),
            value: formatShortDateTime(project.createdAt, locale),
          },
        ]}
        projectLogo={project.logo}
        projectName={project.name}
        showBackOnMobile
        websiteUrl={project.websiteUrl}
      />

      <div className="mt-6 w-full px-2">
        <WorkspaceCalendar
          activeOrganizationId={session?.session?.activeOrganizationId ?? null}
          initialDate={initialDate}
          items={items}
          key={`${initialDate}-${scope ?? "workspace"}-${assigneeId ?? "all"}-${calendarStatus ?? "all"}`}
          latestDate={format(latestCalendarDate, "yyyy-MM-dd")}
          pagination={pagination}
          projectId={project.id}
          range={range}
          sources={[
            {
              sourceId,
              sourceType: "PROJECT",
              displayName: project.name,
              logoUrl: project.logo,
              paletteToken: "violet",
            },
          ]}
          coworkers={coworkers.map((coworker) => ({
            id: coworker.id,
            name: coworker.name,
          }))}
        />
      </div>
    </div>
  );
}
