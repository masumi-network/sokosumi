import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import {
  SECTION_ORDER,
  SECTION_STATUSES,
} from "@/app/projects/components/social-posts/constants";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import { PROJECTS_DETAIL_SHELL_CLASS } from "@/app/projects/constants";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

// Wait for the current session and project access before rendering this page.
export const instant = false;

interface ProjectSocialPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectSocialPage({
  params,
}: ProjectSocialPageProps) {
  await connection();
  if (!(await hasCurrentUserSocialBetaAccess())) {
    notFound();
  }

  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);
  if (!project) {
    notFound();
  }

  const [pages, connections, t, formatter] = await Promise.all([
    Promise.all(
      SECTION_ORDER.map((section) =>
        projectService.listSocialPosts(project.id, {
          statuses: SECTION_STATUSES[section],
        }),
      ),
    ),
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
        // The page turns away anyone without Social beta.
        socialBeta
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
          posts={pages.flatMap((page) => page.posts)}
          nextCursors={Object.fromEntries(
            SECTION_ORDER.map((section, index) => [
              section,
              pages[index].nextCursor,
            ]),
          )}
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
