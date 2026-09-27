import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import {
  SECTION_ORDER,
  SECTION_STATUSES,
} from "@/app/projects/components/social-posts/constants";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
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
  const workspaceLabels = await getProjectWorkspaceLabels();
  const activeConnections = connections.filter(
    (socialConnection) => socialConnection.status === "active",
  );

  return (
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
      // This page 404s without beta access, so reaching it means the tab
      // belongs in the row.
      showSocialTab
      websiteUrl={project.websiteUrl}
    >
      <div className="space-y-8">
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
    </ProjectWorkspaceShell>
  );
}
