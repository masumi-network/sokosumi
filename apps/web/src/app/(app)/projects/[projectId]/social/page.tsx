import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import { PROJECTS_DETAIL_SHELL_CLASS } from "@/app/projects/constants";
import { hasCurrentUserCalendarBetaAccess } from "@/lib/calendar-beta-access.server";
import { projectService } from "@/lib/services/project.service";
import { formatShortDateTime } from "@/lib/utils/datetime";

interface ProjectSocialPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectSocialPage({
  params,
}: ProjectSocialPageProps) {
  await connection();
  if (!(await hasCurrentUserCalendarBetaAccess())) {
    notFound();
  }

  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);
  if (!project) {
    notFound();
  }

  const [posts, connections, t, locale] = await Promise.all([
    projectService.listSocialPosts(project.id),
    projectService.listSocialConnections(project.id),
    getTranslations("App.Projects.Detail"),
    getLocale(),
  ]);
  const activeConnections = connections.filter(
    (socialConnection) => socialConnection.status === "active",
  );

  return (
    <div className={PROJECTS_DETAIL_SHELL_CLASS}>
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

      <div className="mt-8">
        <ProjectSocialPosts
          connections={activeConnections}
          locale={locale}
          posts={posts}
          projectId={project.id}
        />
      </div>
    </div>
  );
}
