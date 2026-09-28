import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  ProjectBrandCard,
  ProjectBrandProvider,
} from "@/app/projects/components/project-brand-card";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { fetchDesignMdMarkdown } from "@/components/design-md/design-md-edit-page-shared";
import Markdown from "@/components/markdown";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

// Wait for the current session and project access before rendering, as the
// project's other areas do.
export const instant = false;

interface ProjectDesignPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * The Design tab: a project's DESIGN.md, read here rather than downloaded.
 *
 * The document was only ever reachable as a blob URL in a dropdown or as raw
 * Markdown in the editor, so "what does this project look like" meant leaving
 * the project. The card above it is the same `ProjectBrandCard` the overview
 * shows, because every action on this file — generate, upload, open raw, edit,
 * remove — already lives there and a second copy of those buttons would be a
 * second thing to keep in step.
 */
export default async function ProjectDesignPage({
  params,
}: ProjectDesignPageProps) {
  const [socialBetaEnabled, { projectId }] = await Promise.all([
    hasCurrentUserSocialBetaAccess(),
    params,
  ]);
  const project = await projectService.getProjectById(projectId);

  if (!project) {
    notFound();
  }

  const [t, tDesignMd, formatter] = await Promise.all([
    getTranslations("App.Projects.Detail"),
    getTranslations("App.DesignMd"),
    getFormatter(),
  ]);
  const workspaceLabels = await getProjectWorkspaceLabels();

  const designMdUrl = project.designMd?.url;
  const loaded = designMdUrl ? await fetchDesignMdMarkdown(designMdUrl) : null;

  return (
    <ProjectWorkspaceShell
      metadata={[
        {
          label: t("header.updated"),
          value: formatter.dateTime(project.updatedAt, "dateTime"),
        },
      ]}
      labels={workspaceLabels}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      showSocialTab={socialBetaEnabled}
      websiteUrl={project.websiteUrl}
    >
      <ProjectBrandProvider
        key={project.designMd?.url ?? "project-brand-empty"}
        projectId={project.id}
        initialDesignMd={project.designMd}
        websiteUrl={project.websiteUrl}
      >
        <div className="max-w-3xl min-w-0 space-y-8">
          <ProjectBrandCard
            projectId={project.id}
            projectName={project.name}
            logo={project.logo}
            websiteUrl={project.websiteUrl}
          />

          <section className="space-y-2" data-testid="project-design-document">
            <h2 className="text-muted-foreground text-xs font-medium">
              {t("design.document")}
            </h2>
            {loaded && "markdown" in loaded ? (
              <Markdown className="text-foreground">{loaded.markdown}</Markdown>
            ) : (
              <p className="text-muted-foreground text-sm">
                {loaded
                  ? tDesignMd("editLoadErrorDescription")
                  : t("design.empty")}
              </p>
            )}
          </section>
        </div>
      </ProjectBrandProvider>
    </ProjectWorkspaceShell>
  );
}
