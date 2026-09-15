import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";

import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import { PROJECTS_DETAIL_SHELL_CLASS } from "@/app/projects/constants";
import { hasCurrentUserCalendarBetaAccess } from "@/lib/calendar-beta-access.server";
import { projectService } from "@/lib/services/project.service";

// Wait for the current session and project access before rendering this page.
export const instant = false;

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

  const [posts, connections, t, formatter] = await Promise.all([
    projectService.listSocialPosts(project.id),
    projectService.listSocialConnections(project.id),
    getTranslations("App.Projects.Detail"),
    getFormatter(),
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

      <div className="mt-8 space-y-8">
        <ProjectSocialPosts
          connections={activeConnections}
          posts={posts}
          projectId={project.id}
        />
        <ProjectSocialAccounts
          projectId={project.id}
          connections={connections}
        />
      </div>
    </div>
  );
}
